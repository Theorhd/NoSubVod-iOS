import React from "react";
import { useNavigate } from "react-router-dom";
import { LiveStatusMap, SubEntry } from "../../../../shared/types";
import { Users, X } from "lucide-react";
import styles from "./MySubsList.module.scss";

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
      <div className={styles["extracted-style-1"]}>
        <div className="section-header">
          <h2>
            <Users size={20} /> Your Subs
          </h2>
        </div>

        <div
          className={`subs-list-scroll-hidden ${styles["extracted-style-2"]}`}
        >
          {subs.length === 0 ? (
            <div className={`card glass ${styles["extracted-style-3"]}`}>
              <div className={styles["extracted-style-4"]}>
                No channels followed yet.
              </div>
            </div>
          ) : (
            subs.map((sub) => {
              const isLive = Boolean(liveStatus[sub.login.toLowerCase()]);
              return (
                <div
                  key={sub.login}
                  className={`glass-hover ${styles["extracted-style-5"]}`}
                >
                  <div className={styles["extracted-style-6"]}>
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
                      <span className={styles["extracted-style-7"]}>LIVE</span>
                    )}
                  </div>

                  <button
                    className={`stretched-link ${styles["extracted-style-8"]}`}
                    aria-label={`Ouvrir la chaîne de ${sub.displayName}`}
                    onClick={() =>
                      navigate(`/channel?user=${encodeURIComponent(sub.login)}`)
                    }
                  />

                  <div className={styles["extracted-style-9"]}>
                    {sub.displayName}
                  </div>

                  <button
                    className={`secondary-btn ${styles["extracted-style-10"]}`}
                    aria-label={`Supprimer ${sub.displayName}`}
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
      </div>
    );
  },
);

MySubsList.displayName = "MySubsList";
export default MySubsList;
