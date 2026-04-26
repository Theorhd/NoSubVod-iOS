import React from "react";
import { useNavigate } from "react-router-dom";
import LiquidGlass from "liquid-glass-react";
import { LiveStatusMap, SubEntry } from "../../../../shared/types";
import { Users, X } from "lucide-react";

interface MySubsListProps {
  readonly subs: SubEntry[];
  readonly liveStatus: LiveStatusMap;
  readonly handleDeleteSub: (
    e: React.MouseEvent,
    login: string,
  ) => Promise<void>;
}

const MySubsList = React.memo(
  ({ subs, liveStatus, handleDeleteSub }: MySubsListProps) => {
    const navigate = useNavigate();

    return (
      <div style={{ marginBottom: "32px" }}>
        <div className="section-header">
          <h2>
            <Users size={20} /> Your Subs
          </h2>
        </div>

        <div
          className="subs-list-scroll-hidden"
          style={{
            display: "flex",
            gap: "12px",
            overflowX: "auto",
            paddingBottom: "12px",
            scrollSnapType: "x mandatory",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
            willChange: "transform",
            transform: "translateZ(0)",
          }}
        >
          {subs.length === 0 ? (
            <LiquidGlass
              className="card"
              cornerRadius={14}
              style={{
                width: "100%",
                textAlign: "center",
                padding: "32px",
                backgroundColor: "var(--surface)",
              }}
            >
              <div style={{ color: "var(--text-muted)" }}>
                No channels followed yet.
              </div>
            </LiquidGlass>
          ) : (
            subs.map((sub) => {
              const isLive = Boolean(liveStatus[sub.login.toLowerCase()]);
              return (
                <LiquidGlass
                  key={sub.login}
                  cornerRadius={20}
                  onClick={() =>
                    navigate(`/channel?user=${encodeURIComponent(sub.login)}`)
                  }
                  style={{
                    flex: "0 0 auto",
                    width: "120px",
                    padding: "16px 12px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                    cursor: "pointer",
                    position: "relative",
                    scrollSnapAlign: "start",
                    backgroundColor: "var(--surface)",
                  }}
                >
                  <div style={{ position: "relative" }}>
                    <img
                      src={sub.profileImageURL}
                      alt={sub.displayName}
                      style={{
                        width: "64px",
                        height: "64px",
                        borderRadius: "50%",
                        border: isLive
                          ? "2px solid var(--danger)"
                          : "1px solid var(--border)",
                        padding: "2px",
                      }}
                    />
                    {isLive && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: "-4px",
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: "var(--danger)",
                          color: "#fff",
                          fontSize: "0.6rem",
                          fontWeight: 800,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          boxShadow: "0 2px 8px rgba(255,107,135,0.4)",
                          zIndex: 2,
                        }}
                      >
                        LIVE
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      width: "100%",
                      position: "relative",
                      zIndex: 1,
                    }}
                  >
                    {sub.displayName}
                  </div>

                  <button
                    className="secondary-btn"
                    aria-label={`Supprimer ${sub.displayName}`}
                    style={{
                      position: "absolute",
                      top: "4px",
                      right: "4px",
                      width: "24px",
                      height: "24px",
                      padding: 0,
                      borderRadius: "50%",
                      opacity: 0,
                      transition: "opacity 0.2s ease",
                      zIndex: 10,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteSub(e, sub.login);
                    }}
                    type="button"
                  >
                    <X size={14} />
                  </button>
                </LiquidGlass>
              );
            })
          )}
        </div>
      </div>
    );
  },
);

MySubsList.displayName = "MySubsList";
export default MySubsList;
