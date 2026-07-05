import React from "react";
import { useNavigate } from "react-router-dom";
import { WifiOff, Download } from "lucide-react";
import "./styles/OfflineHome.css";

export default function OfflineHome() {
  const navigate = useNavigate();

  return (
    <div className="container offline-home">
      <WifiOff size={80} strokeWidth={1.5} className="offline-home__icon" />
      <h1 className="offline-home__title">Vous êtes hors ligne</h1>
      <p className="offline-home__description">
        {
          "Il semble que vous n'ayez pas de connexion Internet. Pas de problème ! Vous pouvez toujours regarder vos vidéos téléchargées."
        }
      </p>
      <button
        className="action-btn offline-home__btn"
        onClick={() => navigate("/downloads")}
        type="button"
      >
        <Download size={20} />
        Aller aux téléchargements
      </button>
    </div>
  );
}
