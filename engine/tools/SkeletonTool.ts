
import { engineInstance } from '../engine';
import { assetManager } from '../AssetManager';
import { SkeletonAsset, SkeletalMeshAsset } from '@/types';
import { Vec3 } from '../math';
import { DebugRenderer } from '../renderers/DebugRenderer';

export interface SkeletonToolOptions {
    enabled: boolean;
    drawJoints: boolean;
    drawBones: boolean;
    drawAxes: boolean; 

    /** Joint size in screen pixels (DebugRenderer point size). */
    jointRadius: number;

    /** Multiplier applied to the root joint size. */
    rootScale: number;

    /** Default bone line color (used when a bone has no visual.color). */
    boneColor: { r: number; g: number; b: number };

    /** Default root joint color (used when root has no visual.color). */
    rootColor: { r: number; g: number; b: number };

    /** Debug point outline thickness (0..1). */
    border: number;
}

const DEFAULT_OPTIONS: SkeletonToolOptions = {
    enabled: true,
    drawJoints: true,
    drawBones: true,
    drawAxes: false, // Default off
    jointRadius: 10,
    rootScale: 1.6,
    boneColor: { r: 0.5, g: 0.5, b: 0.5 },
    rootColor: { r: 0.2, g: 1.0, b: 0.2 },
    border: 0.2
};

export class SkeletonTool {
    // We no longer rely on activeAssetId/activeEntityId for main drawing loop
    private options: SkeletonToolOptions = { ...DEFAULT_OPTIONS };

    /** 
     * Kept for compatibility. The main drawing loop now iterates all skeletons.
     * We could use this to highlight the 'active' skeleton if needed in future.
     */
    setActive(assetId: string | null, entityId: string | null) {
        // No-op
    }

    /** Backwards compatible. */
    setActiveAsset(assetId: string | null) {
        // No-op
    }

    setOptions(partial: Partial<SkeletonToolOptions>) {
        this.options = { ...this.options, ...partial };
    }

    getOptions(): SkeletonToolOptions {
        return this.options;
    }

    update() {
        if (!this.options.enabled) return;

        const debug = engineInstance.debugRenderer;
        if (!debug) return;

        // 1. Draw Standalone Skeletons (Rig-only entities)
        engineInstance.skeletonEntityAssetMap.forEach((assetId, entityId) => {
            this.drawSkeleton(assetId, entityId, debug, true);
        });

        // 2. Draw Skeletal Meshes
        // Iterate all entities that have spawned bones (skeletonMap keys)
        engineInstance.skeletonMap.forEach((_, entityId) => {
            // Check if it's already handled as a standalone skeleton (avoid double draw)
            if (engineInstance.skeletonEntityAssetMap.has(entityId)) return;

            const idx = engineInstance.ecs.idToIndex.get(entityId);
            if (idx !== undefined && engineInstance.ecs.store.isActive[idx]) {
                const meshIntId = engineInstance.ecs.store.meshType[idx];
                const assetId = assetManager.meshIntToUuid.get(meshIntId);
                if (assetId) {
                    this.drawSkeleton(assetId, entityId, debug, false);
                }
            }
        });
    }

    private drawSkeleton(assetId: string, entityId: string, debug: DebugRenderer, isStandalone: boolean) {
        const asset = assetManager.getAsset(assetId) as (SkeletonAsset | SkeletalMeshAsset | undefined);
        if (!asset) return;

        const skeleton = (asset as any).skeleton as { bones: any[] } | undefined;
        if (!skeleton || !Array.isArray(skeleton.bones)) return;

        const worldMat = engineInstance.sceneGraph.getWorldMatrix(entityId);
        if (!worldMat) return;

        // Manual matrix multiplication helper for points
        const transform = (x: number, y: number, z: number) => ({
            x: worldMat[0] * x + worldMat[4] * y + worldMat[8] * z + worldMat[12],
            y: worldMat[1] * x + worldMat[5] * y + worldMat[9] * z + worldMat[13],
            z: worldMat[2] * x + worldMat[6] * y + worldMat[10] * z + worldMat[14]
        });

        // Manual matrix rotation helper (ignores translation) for axes
        const rotate = (x: number, y: number, z: number) => ({
            x: worldMat[0] * x + worldMat[4] * y + worldMat[8] * z,
            y: worldMat[1] * x + worldMat[5] * y + worldMat[9] * z,
            z: worldMat[2] * x + worldMat[6] * y + worldMat[10] * z
        });

        if (isStandalone) {
            const origin = { x: worldMat[12], y: worldMat[13], z: worldMat[14] };

            // entity basis (columns of worldMat)
            const ex = { x: worldMat[0], y: worldMat[1], z: worldMat[2] };
            const ey = { x: worldMat[4], y: worldMat[5], z: worldMat[6] };
            const ez = { x: worldMat[8], y: worldMat[9], z: worldMat[10] };

            this.drawAxis(debug, origin, ex, ey, ez, 0.6);
        }

        const bones = skeleton.bones;
        // 1. Get the list of live bone entities for this mesh/skeleton
        const liveBoneIds = engineInstance.skeletonMap.get(entityId);

        for (let i = 0; i < bones.length; i++) {
            const bone = bones[i];
            const p = (bone as any).parentIndex;
            const isRoot = p === -1 || p === undefined || p === null;

            let pos = { x: 0, y: 0, z: 0 };
            let rx = { x: 1, y: 0, z: 0 };
            let ry = { x: 0, y: 1, z: 0 };
            let rz = { x: 0, y: 0, z: 1 };
            
            // Try to get the LIVE position from the Entity first
            let usedLiveEntity = false;
            
            if (liveBoneIds && liveBoneIds[i]) {
                const liveBoneId = liveBoneIds[i];
                const liveWm = engineInstance.sceneGraph.getWorldMatrix(liveBoneId);
                if (liveWm) {
                    // Use the actual Entity position
                    pos = { x: liveWm[12], y: liveWm[13], z: liveWm[14] };
                    
                    // Calculate axes from live matrix (Columns 0, 1, 2)
                    // Normalize to ensure consistent visualization length regardless of scaling
                    const lx = Math.sqrt(liveWm[0]**2 + liveWm[1]**2 + liveWm[2]**2) || 1;
                    rx = { x: liveWm[0]/lx, y: liveWm[1]/lx, z: liveWm[2]/lx };
                    
                    const ly = Math.sqrt(liveWm[4]**2 + liveWm[5]**2 + liveWm[6]**2) || 1;
                    ry = { x: liveWm[4]/ly, y: liveWm[5]/ly, z: liveWm[6]/ly };
                    
                    const lz = Math.sqrt(liveWm[8]**2 + liveWm[9]**2 + liveWm[10]**2) || 1;
                    rz = { x: liveWm[8]/lz, y: liveWm[9]/lz, z: liveWm[10]/lz };

                    usedLiveEntity = true;
                }
            }

            // Fallback: If no entity found (or detached), calculate from BindPose + Parent Mesh
            if (!usedLiveEntity) {
                // Extract world position from bind pose (local relative to model root) transformed by Entity World Matrix
                const bx = bone.bindPose[12];
                const by = bone.bindPose[13];
                const bz = bone.bindPose[14];
                pos = transform(bx, by, bz);

                // Extract rotation basis vectors from bind pose
                // Column 0 = X, Column 1 = Y, Column 2 = Z
                const brx = { x: bone.bindPose[0], y: bone.bindPose[1], z: bone.bindPose[2] };
                const bry = { x: bone.bindPose[4], y: bone.bindPose[5], z: bone.bindPose[6] };
                const brz = { x: bone.bindPose[8], y: bone.bindPose[9], z: bone.bindPose[10] };

                // Transform local basis vectors to world space
                rx = rotate(brx.x, brx.y, brx.z);
                ry = rotate(bry.x, bry.y, bry.z);
                rz = rotate(brz.x, brz.y, brz.z);
            }

            if (isRoot) {
                // Root axis: always for standalone skeleton assets, otherwise follow drawAxes
                const drawRootAxis = isStandalone || this.options.drawAxes;
                if (drawRootAxis) {
                    const axisScale = 0.35 * this.options.rootScale;
                    this.drawAxis(debug, pos, rx, ry, rz, axisScale);
                }

                // Root sphere (keep as requested)
                if (this.options.drawJoints) {
                    const radius = 0.3 * this.options.rootScale; // World unit size approx
                    this.drawWireSphere(debug, pos, radius, this.options.rootColor);
                }
            } else {
                // Standard joint dot
                if (this.options.drawJoints) {
                    let r = this.options.jointRadius;
                    const mult = bone.visual?.size ?? 1.0;
                    r *= mult;
                    
                    let color = { r: 1, g: 0.5, b: 0 };
                    if (bone.visual?.color) {
                        const c = bone.visual.color;
                        color = { r: c.x ?? c[0] ?? color.r, g: c.y ?? c[1] ?? color.g, b: c.z ?? c[2] ?? color.b };
                    }
                    debug.drawPoint(pos, color, r, this.options.border);
                }
            }

            if (this.options.drawAxes && !isRoot) {
                const axisScale = 0.3; // Length of debug axes
                this.drawAxis(debug, pos, rx, ry, rz, axisScale);
            }

            // Draw bone connection line
            if (this.options.drawBones && !isRoot && typeof p === 'number' && p >= 0 && p < bones.length) {
                let pPos = { x: 0, y: 0, z: 0 };
                let pUsedLive = false;

                if (liveBoneIds && liveBoneIds[p]) {
                    const pLiveId = liveBoneIds[p];
                    const pWm = engineInstance.sceneGraph.getWorldMatrix(pLiveId);
                    if (pWm) {
                        pPos = { x: pWm[12], y: pWm[13], z: pWm[14] };
                        pUsedLive = true;
                    }
                }

                if (!pUsedLive) {
                    const parent = bones[p];
                    if (parent?.bindPose) {
                        pPos = transform(parent.bindPose[12], parent.bindPose[13], parent.bindPose[14]);
                    }
                }
                
                debug.drawLine(pPos, pos, this.options.boneColor);
            }
        }
    }

    private drawWireSphere(debug: any, center: Vec3, radius: number, color: {r: number, g: number, b: number}) {
        const segments = 12;
        
        // Draw 3 orthogonal circles (XY, YZ, XZ)
        
        // XY Circle
        let prev = { x: center.x + radius, y: center.y, z: center.z };
        for(let i = 1; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2;
            const next = {
                x: center.x + Math.cos(theta) * radius,
                y: center.y + Math.sin(theta) * radius,
                z: center.z
            };
            debug.drawLine(prev, next, color);
            prev = next;
        }

        // YZ Circle
        prev = { x: center.x, y: center.y + radius, z: center.z };
        for(let i = 1; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2;
            const next = {
                x: center.x,
                y: center.y + Math.cos(theta) * radius,
                z: center.z + Math.sin(theta) * radius
            };
            debug.drawLine(prev, next, color);
            prev = next;
        }

        // XZ Circle
        prev = { x: center.x + radius, y: center.y, z: center.z };
        for(let i = 1; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2;
            const next = {
                x: center.x + Math.cos(theta) * radius,
                y: center.y,
                z: center.z + Math.sin(theta) * radius
            };
            debug.drawLine(prev, next, color);
            prev = next;
        }
    }

    private drawAxis(
        debug: DebugRenderer,
        origin: Vec3,
        xAxis: Vec3,
        yAxis: Vec3,
        zAxis: Vec3,
        scale: number
    ) {
        debug.drawLine(origin, { x: origin.x + xAxis.x * scale, y: origin.y + xAxis.y * scale, z: origin.z + xAxis.z * scale }, { r: 1, g: 0, b: 0 });
        debug.drawLine(origin, { x: origin.x + yAxis.x * scale, y: origin.y + yAxis.y * scale, z: origin.z + yAxis.z * scale }, { r: 0, g: 1, b: 0 });
        debug.drawLine(origin, { x: origin.x + zAxis.x * scale, y: origin.y + zAxis.y * scale, z: origin.z + zAxis.z * scale }, { r: 0, g: 0, b: 1 });
    }
}

export const skeletonTool = new SkeletonTool();
