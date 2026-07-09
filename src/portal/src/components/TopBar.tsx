import React, { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Monitor } from "lucide-react";
import { navigateBackInApp } from "../utils/navigation";
import styles from "./TopBar.module.scss";

export interface TopBarProps {
  title?: ReactNode;
  mode?: "back" | "home" | "logo";
  actions?: ReactNode;
  onLogoClick?: () => void;
}

export const TopBar = React.memo(
  ({
    title = "NoSubVod",
    mode = "logo",
    actions,
    onLogoClick,
  }: Readonly<TopBarProps>) => {
    const navigate = useNavigate();

    return (
      <div className="top-bar">
        <div className={`bar-main ${styles["extracted-style-1"]}`}>
          {(mode === "back" || mode === "home") && (
            <button
              onClick={() =>
                mode === "back"
                  ? navigateBackInApp(navigate, "/")
                  : navigate("/")
              }
              className={`secondary-btn ${styles["extracted-style-2"]}`}
              aria-label="Back"
              type="button"
            >
              <ArrowLeft size={20} />
            </button>
          )}

          {mode === "logo" ? (
            <button
              onClick={onLogoClick || (() => navigate("/"))}
              type="button"
              aria-label="Home"
              className={styles["extracted-style-3"]}
            >
              <img
                src="/icon_2.png"
                alt="NoSubVod"
                className={styles["extracted-style-4"]}
              />
              <h1 className={styles["extracted-style-5"]}>{title}</h1>
            </button>
          ) : (
            <h1 className={styles["extracted-style-6"]}>{title}</h1>
          )}
        </div>

        {(actions || mode === "logo") && (
          <div className={`top-actions ${styles["extracted-style-7"]}`}>
            {mode === "logo" && (
              <button
                onClick={() => navigate("/multi-view")}
                className={`secondary-btn ${styles["extracted-style-8"]}`}
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
  },
);

TopBar.displayName = "TopBar";
