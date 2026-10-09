"use client";

import { useEffect, useRef, useState } from "react";
import { formatDate } from "../lib/game";

type ScoreCard = {
  username: string; week: string; score: number; lineup: number; bonus: number;
  finalized: boolean; weeklyRank: string; seasonRank: string;
};

async function scoreImage(card: ScoreCard): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200; canvas.height = 800;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image creation is unavailable.");
  const bg = ctx.createLinearGradient(0, 0, 1200, 800);
  bg.addColorStop(0, "#161616"); bg.addColorStop(1, "#080808");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1200, 800);
  ctx.strokeStyle = "#796200"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(24, 24, 1152, 752, 32); ctx.stroke();
  const logo = new Image();
  logo.src = "/mooberball-logo.png";
  try {
    await logo.decode();
    const scale = Math.min(320 / logo.width, 110 / logo.height);
    ctx.drawImage(logo, 820, 60, logo.width * scale, logo.height * scale);
  } catch {
    ctx.fillStyle = "#ffcc00"; ctx.font = "bold 32px Arial"; ctx.fillText("MOOBERBALL", 820, 110);
  }
  const text = (value: string, x: number, y: number, font: string, color: string) => {
    ctx.font = font; ctx.fillStyle = color; ctx.fillText(value, x, y, 1040);
  };
  text("YOUR WEEKLY SCORE", 70, 110, "30px Arial", "#c5c5c5");
  text(card.username, 70, 177, "bold 40px Arial", "#fff");
  text(`${card.score} pts`, 70, 300, "bold 104px Arial", "#ffcc00");
  text(`Weekly rank: ${card.weeklyRank}`, 70, 390, "bold 34px Arial", "#ffcc00");
  text(`Season rank: ${card.seasonRank}`, 70, 450, "bold 34px Arial", "#ffcc00");
  text(`${card.lineup} lineup points · ${card.finalized ? `${card.bonus} birthday bonus` : "Birthday bonus pending"}`, 70, 530, "30px Arial", "#c5c5c5");
  text(`Week beginning ${formatDate(card.week)}`, 70, 580, "30px Arial", "#c5c5c5");
  text(card.finalized ? "FINAL WEEKLY SCORE" : "IN PROGRESS · Completed daily scores only", 70, 650, "bold 24px Arial", "#ffcc00");
  text("mooberball.com", 70, 720, "26px Arial", "#c5c5c5");
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Unable to create image.")), "image/png"));
}

export default function ShareScore({ card }: { card: ScoreCard }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [image, setImage] = useState<{ url: string; file: File } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);

  async function prepare() {
    setBusy(true); setMessage(""); setImage(null);
    dialog.current?.showModal();
    try {
      const blob = await scoreImage(card);
      const file = new File([blob], `mooberball-score-${card.week}.png`, { type: "image/png" });
      setImage({ url: URL.createObjectURL(blob), file });
    } catch { setMessage("Unable to create your card. Please try again."); }
    finally { setBusy(false); }
  }
  async function share() {
    if (!image) return;
    setMessage("");
    try {
      await navigator.share({ files: [image.file], title: "My Mooberball weekly score" });
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setMessage("Sharing is unavailable here. Download the image and upload it to your Facebook group.");
    }
  }
  const canShare = image && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [image.file] });
  return <>
    <button type="button" className="secondary-button share-score-button" onClick={() => void prepare()} disabled={busy}>Share my score card</button>
    <dialog ref={dialog} className="score-share-dialog" aria-labelledby="score-share-title">
      <h2 id="score-share-title">Share your weekly score</h2>
      <p className="muted">Choose Facebook in your device’s share menu if available. To post to the group, you can also download the image and attach it to a Facebook post.</p>
      {busy && <p role="status">Creating your score card…</p>}
      {image && <>
        <img src={image.url} alt="Preview of your personal Mooberball weekly score card" className="score-share-preview" />
        <div className="score-share-actions">
          {canShare && <button type="button" onClick={() => void share()}>Share image</button>}
          <a className="button secondary-button" href={image.url} download={image.file.name}>Download image</a>
        </div>
      </>}
      {message && <p role="status">{message}</p>}
      <button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>Close</button>
    </dialog>
  </>;
}
