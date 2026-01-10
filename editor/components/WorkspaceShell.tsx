
import React from 'react';
import DockLayout, { LayoutData, BoxData } from 'rc-dock';

interface WorkspaceShellProps {
    children: React.ReactNode;
}

export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({ children }) => {
    const defaultLayout: LayoutData = {
        dockbox: {
            mode: 'horizontal',
            children: [
                {
                    tabs: [
                        { 
                            id: 'viewport', 
                            title: 'Viewport', 
                            content: <div className="w-full h-full overflow-hidden bg-black relative">{children}</div>, 
                            closable: false 
                        }
                    ]
                }
            ]
        }
    };

    return (
        <div className="w-full h-full bg-black relative">
            <DockLayout
                defaultLayout={defaultLayout}
                style={{ width: '100%', height: '100%', background: '#000' }}
                dropMode="edge"
            />
        </div>
    );
};
