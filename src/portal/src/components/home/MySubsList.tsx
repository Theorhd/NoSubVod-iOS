import React from "react";
import { useNavigate } from "react-router-dom";
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
          style={{
            display: "flex",
            gap: "12px",
            overflowX: "auto",
            paddingBottom: "12px",
            scrollSnapType: "x mandatory",
            scrollbarWidth: "none",
          }}
        >
          {subs.length === 0 ? (
            <div
              className="card glass"
              style={{ width: "100%", textAlign: "center", padding: "32px" }}
            >
              <div style={{ color: "var(--text-muted)" }}>
                No channels followed yet.
              </div>
            </div>
          ) : (
            subs.map((sub) => {
              const isLive = Boolean(liveStatus[sub.login.toLowerCase()]);
              return (
                <div
                  key={sub.login}
                  className="glass-hover"
                  style={{
                    flex: "0 0 auto",
                    width: "120px",
                    padding: "16px 12px",
                    borderRadius: "var(--radius-lg)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                    cursor: "pointer",
                    position: "relative",
                    scrollSnapAlign: "start",
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

                  <button
                    className="stretched-link"
                    aria-label={`Ouvrir la chaîne de ${sub.displayName}`}
                    onClick={() =>
                      navigate(`/channel?user=${encodeURIComponent(sub.login)}`)
                    }
                    style={{ background: "none", border: "none", padding: 0 }}
                  />

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
                </div>
              );
            })
          )}
        </div>

        <style>{`
        .glass-hover:hover button.secondary-btn { opacity: 1 !important; }
        div::-webkit-scrollbar { display: none; }
      `}</style>
      </div>
    );
  },
);

MySubsList.displayName = "MySubsList";
export default MySubsList;
