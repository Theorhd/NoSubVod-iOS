import React, { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Monitor } from 'lucide-react';

export interface TopBarProps {
  title?: ReactNode;
  mode?: 'back' | 'home' | 'logo';
  actions?: ReactNode;
  onLogoClick?: () => void;
}

export const TopBar = React.memo(
  ({ title = 'NoSubVod', mode = 'logo', actions, onLogoClick }: Readonly<TopBarProps>) => {
    const navigate = useNavigate();

    return (
      <div className="top-bar">
        <div className="bar-main" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {(mode === 'back' || mode === 'home') && (
            <button
              onClick={() => (mode === 'back' ? navigate(-1) : navigate('/'))}
              className="secondary-btn"
              style={{ width: '40px', height: '40px', padding: 0, borderRadius: '50%' }}
              aria-label="Back"
              type="button"
            >
              <ArrowLeft size={20} />
            </button>
          )}

          {mode === 'logo' ? (
            <button
              onClick={onLogoClick || (() => navigate('/'))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                padding: 0,
                textAlign: 'left',
                color: 'inherit',
                font: 'inherit',
              }}
              type="button"
              aria-label="Home"
            >
              <img src="/icon.png" alt="NoSubVod" style={{ width: '28px', height: '28px' }} />
              <h1
                style={{
                  background: 'linear-gradient(to right, #fff, #8f57ff)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  margin: 0,
                }}
              >
                {title}
              </h1>
            </button>
          ) : (
            <h1 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>{title}</h1>
          )}
        </div>

        {(actions || mode === 'logo') && (
          <div
            className="top-actions"
            style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
          >
            {mode === 'logo' && (
              <button
                onClick={() => navigate('/multi-view')}
                className="secondary-btn"
                style={{ width: '40px', height: '40px', padding: 0, borderRadius: '50%' }}
                aria-label="Multi-View"
                title="Multi-View"
                type="button"
              >
                <Monitor size={20} />
              </button>
            )}
            {actions}
          </div>
        )}
      </div>
    );
  }
);

TopBar.displayName = 'TopBar';
