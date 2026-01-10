
import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { assetManager } from '@/engine/AssetManager';
import { StaticMeshAsset, SkeletalMeshAsset } from '@/types';
import { Mat4Utils, Vec3Utils } from '@/engine/math';
import { Icon } from './Icon';

const VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
uniform mat4 u_mvp;
uniform mat4 u_model;
out vec3 v_normal;
void main() {
    v_normal = normalize(mat3(u_model) * a_normal);
    gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 v_normal;
uniform vec3 u_lightDir;
uniform vec3 u_color;
uniform int u_renderMode; // 0: Lit, 1: Flat, 2: Normals
out vec4 outColor;
void main() {
    if (u_renderMode == 1) {
        outColor = vec4(u_color, 1.0);
        return;
    }
    vec3 n = normalize(v_normal);
    if (u_renderMode == 2) {
        outColor = vec4(n * 0.5 + 0.5, 1.0);
        return;
    }
    vec3 l = normalize(-u_lightDir);
    float diff = max(dot(n, l), 0.0);
    float hemi = max(0.0, 0.5 + 0.5 * n.y);
    vec3 ambient = vec3(0.1) + vec3(0.1, 0.1, 0.2) * hemi;
    vec3 diffuse = diff * u_color;
    outColor = vec4(ambient + diffuse, 1.0);
}`;

const GRID_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_mvp;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }`;

const GRID_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }`;

export const StaticMeshEditor: React.FC<{ assetId: string }> = ({ assetId }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const requestRef = useRef<number>(0);
    
    // State
    const [camera, setCamera] = useState({ theta: 0.5, phi: 1.2, radius: 3.0, target: { x: 0, y: 0, z: 0 } });
    const [dragState, setDragState] = useState<{ mode: 'ORBIT'|'PAN'|'ZOOM', startX: number, startY: number, startCamera: typeof camera } | null>(null);
    const [renderMode, setRenderMode] = useState(0); // 0: Lit, 1: Flat, 2: Normals
    const [stats, setStats] = useState({ verts: 0, tris: 0 });
    const [autoRotate, setAutoRotate] = useState(false);

    // Refs for Loop Access
    const cameraRef = useRef(camera);
    useEffect(() => { cameraRef.current = camera; }, [camera]);
    const renderModeRef = useRef(renderMode);
    useEffect(() => { renderModeRef.current = renderMode; }, [renderMode]);
    const autoRotateRef = useRef(autoRotate);
    useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);

    useEffect(() => {
        const asset = assetManager.getAsset(assetId) as StaticMeshAsset | SkeletalMeshAsset;
        if (!asset || (asset.type !== 'MESH' && asset.type !== 'SKELETAL_MESH')) return;

        setStats({ 
            verts: asset.geometry.vertices.length / 3, 
            tris: asset.geometry.indices.length / 3 
        });

        // Calculate auto-fit radius
        if (asset.geometry.aabb) {
            const size = Vec3Utils.subtract(asset.geometry.aabb.max, asset.geometry.aabb.min, {x:0,y:0,z:0});
            const maxDim = Math.max(size.x, Math.max(size.y, size.z));
            const center = Vec3Utils.scale(Vec3Utils.add(asset.geometry.aabb.min, asset.geometry.aabb.max, {x:0,y:0,z:0}), 0.5, {x:0,y:0,z:0});
            setCamera(p => ({ ...p, radius: maxDim * 1.5, target: center }));
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
        if (!gl) return;

        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0.12, 0.12, 0.12, 1.0); // Slightly lighter than main editor for contrast

        // --- Compile Shaders ---
        const createProgram = (vsSrc: string, fsSrc: string) => {
            const vs = gl.createShader(gl.VERTEX_SHADER)!; gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
            const fs = gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
            const p = gl.createProgram()!; gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
            return p;
        };
        const meshProgram = createProgram(VS, FS);
        const gridProgram = createProgram(GRID_VS, GRID_FS);

        // --- Mesh Buffers ---
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, asset.geometry.vertices, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        
        const nbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
        gl.bufferData(gl.ARRAY_BUFFER, asset.geometry.normals, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        
        const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, asset.geometry.indices, gl.STATIC_DRAW);
        
        // --- Grid Buffers ---
        const gridLines = [];
        const size = 10; const step = 1;
        for(let i=-size; i<=size; i+=step) {
            gridLines.push(i, 0, -size); gridLines.push(i, 0, size);
            gridLines.push(-size, 0, i); gridLines.push(size, 0, i);
        }
        const gridVAO = gl.createVertexArray(); gl.bindVertexArray(gridVAO);
        const gridVBO = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gridVBO);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridLines), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        const count = asset.geometry.indices.length;
        const gridCount = gridLines.length / 3;

        const render = () => {
            if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
                canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
                gl.viewport(0, 0, canvas.width, canvas.height);
            }
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            const cam = cameraRef.current;
            const mode = renderModeRef.current;
            
            if (autoRotateRef.current) {
                cam.theta += 0.005;
                cameraRef.current = { ...cam };
                setCamera({ ...cam }); // Sync React state occasionally? Or just rely on ref for smoothness
            }

            const eyeX = cam.target.x + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta);
            const eyeY = cam.target.y + cam.radius * Math.cos(cam.phi);
            const eyeZ = cam.target.z + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta);

            const aspect = canvas.width / canvas.height;
            const proj = Mat4Utils.create(); Mat4Utils.perspective(45 * Math.PI / 180, aspect, 0.1, 100.0, proj);
            const view = Mat4Utils.create(); Mat4Utils.lookAt({x:eyeX, y:eyeY, z:eyeZ}, cam.target, {x:0, y:1, z:0}, view);
            const mvp = Mat4Utils.create(); Mat4Utils.multiply(proj, view, mvp);

            // Draw Grid
            gl.useProgram(gridProgram);
            gl.uniformMatrix4fv(gl.getUniformLocation(gridProgram, 'u_mvp'), false, mvp);
            gl.uniform4f(gl.getUniformLocation(gridProgram, 'u_color'), 0.3, 0.3, 0.3, 1.0);
            gl.bindVertexArray(gridVAO);
            gl.drawArrays(gl.LINES, 0, gridCount);

            // Draw Mesh
            gl.useProgram(meshProgram);
            gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'u_mvp'), false, mvp);
            gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'u_model'), false, Mat4Utils.create());
            gl.uniform3f(gl.getUniformLocation(meshProgram, 'u_lightDir'), 0.5, -1.0, 0.5);
            gl.uniform3f(gl.getUniformLocation(meshProgram, 'u_color'), 0.8, 0.8, 0.8);
            gl.uniform1i(gl.getUniformLocation(meshProgram, 'u_renderMode'), mode);

            gl.bindVertexArray(vao);
            // Enable polygon offset for wireframe overlay effect if we had it, but here just simple modes
            gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);

            requestRef.current = requestAnimationFrame(render);
        };
        render();

        return () => {
            cancelAnimationFrame(requestRef.current);
            gl.deleteVertexArray(vao); gl.deleteBuffer(vbo); gl.deleteBuffer(nbo); gl.deleteBuffer(ibo);
            gl.deleteVertexArray(gridVAO); gl.deleteBuffer(gridVBO);
            gl.deleteProgram(meshProgram); gl.deleteProgram(gridProgram);
        }
    }, [assetId]); 

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        let mode: 'ORBIT' | 'PAN' | 'ZOOM' = 'ORBIT';
        
        // Standard Controls
        // Alt+LMB or LMB = Orbit
        // Alt+MMB or MMB = Pan
        // Alt+RMB or RMB = Zoom
        
        if (e.altKey) {
            if (e.button === 0) mode = 'ORBIT';
            else if (e.button === 1) mode = 'PAN';
            else if (e.button === 2) mode = 'ZOOM';
        } else {
            if (e.button === 0) mode = 'ORBIT';
            else if (e.button === 1) mode = 'PAN';
            else if (e.button === 2) mode = 'ZOOM';
        }

        setDragState({ mode, startX: e.clientX, startY: e.clientY, startCamera: { ...camera } });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        
        if (dragState.mode === 'ORBIT') {
            setCamera(p => ({ 
                ...p, 
                theta: dragState.startCamera.theta + dx * 0.01, 
                phi: Math.max(0.1, Math.min(Math.PI - 0.1, dragState.startCamera.phi - dy * 0.01)) 
            }));
        } else if (dragState.mode === 'ZOOM') {
            setCamera(p => ({ 
                ...p, 
                radius: Math.max(0.1, dragState.startCamera.radius - (dx - dy) * 0.05) 
            }));
        } else if (dragState.mode === 'PAN') {
            const panSpeed = dragState.startCamera.radius * 0.001;
            const eyeX = dragState.startCamera.radius * Math.sin(dragState.startCamera.phi) * Math.cos(dragState.startCamera.theta);
            const eyeY = dragState.startCamera.radius * Math.cos(dragState.startCamera.phi);
            const eyeZ = dragState.startCamera.radius * Math.sin(dragState.startCamera.phi) * Math.sin(dragState.startCamera.theta);
            
            const forward = Vec3Utils.normalize(Vec3Utils.scale({x:eyeX,y:eyeY,z:eyeZ}, -1, {x:0,y:0,z:0}), {x:0,y:0,z:0});
            const right = Vec3Utils.normalize(Vec3Utils.cross(forward, {x:0,y:1,z:0}, {x:0,y:0,z:0}), {x:0,y:0,z:0});
            const camUp = Vec3Utils.normalize(Vec3Utils.cross(right, forward, {x:0,y:0,z:0}), {x:0,y:0,z:0});
            
            const moveX = Vec3Utils.scale(right, -dx * panSpeed, {x:0,y:0,z:0});
            const moveY = Vec3Utils.scale(camUp, dy * panSpeed, {x:0,y:0,z:0});
            
            setCamera(p => ({ ...p, target: Vec3Utils.add(dragState.startCamera.target, Vec3Utils.add(moveX, moveY, {x:0,y:0,z:0}), {x:0,y:0,z:0}) }));
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#151515] select-none text-xs">
            {/* Toolbar */}
            <div className="h-9 bg-panel-header border-b border-white/5 flex items-center px-3 justify-between shrink-0">
                <div className="flex gap-1 bg-black/20 p-0.5 rounded border border-white/5">
                    <button className={`p-1.5 rounded transition-colors ${renderMode===0?'bg-accent text-white':'text-text-secondary hover:text-white'}`} onClick={()=>setRenderMode(0)} title="Lit"><Icon name="Sun" size={14}/></button>
                    <button className={`p-1.5 rounded transition-colors ${renderMode===1?'bg-accent text-white':'text-text-secondary hover:text-white'}`} onClick={()=>setRenderMode(1)} title="Flat"><Icon name="Square" size={14}/></button>
                    <button className={`p-1.5 rounded transition-colors ${renderMode===2?'bg-accent text-white':'text-text-secondary hover:text-white'}`} onClick={()=>setRenderMode(2)} title="Normals"><Icon name="BoxSelect" size={14}/></button>
                </div>
                
                <div className="flex items-center gap-4 text-[10px] font-mono text-text-secondary">
                    <div className="flex items-center gap-1"><span className="text-accent">{stats.verts}</span> Verts</div>
                    <div className="h-3 w-px bg-white/10"></div>
                    <div className="flex items-center gap-1"><span className="text-accent">{stats.tris}</span> Tris</div>
                </div>

                <button 
                    onClick={() => setAutoRotate(!autoRotate)} 
                    className={`p-1.5 rounded transition-colors ${autoRotate ? 'text-emerald-400 bg-emerald-500/10' : 'text-text-secondary hover:text-white'}`} 
                    title="Auto Rotate"
                >
                    <Icon name="RotateCw" size={14} />
                </button>
            </div>
            
            {/* Viewport */}
            <div ref={containerRef} className="flex-1 relative overflow-hidden" 
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={() => setDragState(null)}
                onMouseLeave={() => setDragState(null)}
                onWheel={e => {
                    setCamera(p => ({ ...p, radius: Math.max(0.1, p.radius + e.deltaY * 0.01) }));
                }}
                onContextMenu={e => e.preventDefault()}
            >
                <div className="absolute inset-0 pointer-events-none opacity-10" style={{ backgroundImage: 'radial-gradient(circle at center, #ffffff 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
                <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair relative z-10" />
            </div>
        </div>
    );
};
