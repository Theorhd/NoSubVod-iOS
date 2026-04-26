import React from "react";
import { Bell, BellRing, CalendarDays, UserPlus } from "lucide-react";
import { UserInfo } from "../../../shared/types";
import Glass from "./Glass";

type StreamerInfoCardProps = {
  streamer: UserInfo;
  isSubbed: boolean;
  isAdding: boolean;
  onAddToSubs: () => void;
  notificationsEnabled: boolean;
  notificationsUpdating: boolean;
  onToggleNotifications: () => void;
};

const computeAccountYears = (createdAt?: string): number | null => {
  if (!createdAt) return null;

  const createdDate = new Date(createdAt);
  if (Number.isNaN(createdDate.getTime())) return null;

  const now = new Date();
  let years = now.getFullYear() - createdDate.getFullYear();
  const anniversaryPassed =
    now.getMonth() > createdDate.getMonth() ||
    (now.getMonth() === createdDate.getMonth() &&
      now.getDate() >= createdDate.getDate());

  if (!anniversaryPassed) {
    years -= 1;
  }

  return Math.max(0, years);
};

const formatYearsLabel = (years: number | null): string => {
  if (years === null) return "Unknown tenure";
  if (years <= 0) return "Less than 1 year";
  return `${years} year${years > 1 ? "s" : ""}`;
};

export const StreamerInfoCard = React.memo<StreamerInfoCardProps>(
  ({
    streamer,
    isSubbed,
    isAdding,
    onAddToSubs,
    notificationsEnabled,
    notificationsUpdating,
    onToggleNotifications,
  }) => {
    const years = computeAccountYears(streamer.createdAt);
    const yearsLabel = formatYearsLabel(years);
    let buttonLabel = "Subscribe";
    let notificationLabel = notificationsEnabled
      ? "Notifications live + VOD actives"
      : "Activer notifications live + VOD";

    if (isAdding) {
      buttonLabel = "Adding...";
    }

    if (notificationsUpdating) {
      notificationLabel = notificationsEnabled
        ? "Mise a jour..."
        : "Activation...";
    }

    return (
      <Glass className="streamer-info-card" cornerRadius={14} elasticity={0.15}>
        <div className="streamer-info-content">
          <img
            className="streamer-info-avatar"
            src={
              streamer.profileImageURL ||
              "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png"
            }
            alt={streamer.displayName || streamer.login}
            loading="lazy"
          />

          <div className="streamer-info-text">
            <p className="streamer-info-kicker">Streamer</p>

            <div className="streamer-info-title-row">
              <h2>{streamer.displayName || streamer.login}</h2>
              <span className="streamer-info-years">
                <CalendarDays size={14} />
                {yearsLabel}
              </span>
            </div>

            <p className="streamer-info-login">@{streamer.login}</p>
          </div>
        </div>

        <div className="streamer-info-actions">
          {isSubbed ? (
            <button
              type="button"
              className={`secondary-btn streamer-notify-btn${notificationsEnabled ? " is-enabled" : ""}`}
              onClick={onToggleNotifications}
              disabled={notificationsUpdating}
            >
              {notificationsEnabled ? (
                <BellRing size={16} />
              ) : (
                <Bell size={16} />
              )}
              {notificationLabel}
            </button>
          ) : (
            <button
              type="button"
              className="action-btn streamer-sub-btn"
              onClick={onAddToSubs}
              disabled={isAdding}
            >
              <UserPlus size={16} />
              {buttonLabel}
            </button>
          )}
        </div>
      </Glass>
    );
  },
);

StreamerInfoCard.displayName = "StreamerInfoCard";
