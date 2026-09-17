"use client";

import { useId } from "react";
import { displayCoin } from "@/lib/format";
import styles from "./TokenIcon.module.css";

export default function TokenIcon({ coin, size = 16 }: { coin: string; size?: number }) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = displayCoin(coin).toUpperCase();
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      {mark(id, gid)}
    </svg>
  );
}

function mark(id: string, gid: string) {
  switch (id) {
    case "BTC":
      return (
        <>
          <circle cx="16" cy="16" r="16" fill="#F7931A" />
          <path
            fill="#FFF"
            d="M22.5 14.1c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.6-.4-.6 2.6c-.4-.1-.9-.2-1.3-.3l.7-2.6-1.6-.4-.7 2.7c-.4-.1-.7-.2-1-.2v-.1l-2.3-.6-.4 1.8s1.2.3 1.2.3c.7.2.8.6.8 1l-.8 3.1c0 .1.1.1.1.1l-.1-.1-1.1 4.5c-.1.2-.3.5-.7.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.1.5c.4.1.8.2 1.2.3l-.7 2.8 1.6.4.7-2.7c.4.1.9.2 1.3.3l-.7 2.7 1.6.4.7-2.8c2.8.5 4.9.3 5.8-2.2.7-2 .1-3.2-1.5-3.9 1.1-.3 1.9-1 2.1-2.5zm-3.8 5.3c-.5 2.1-4 1-5.1.7l.9-3.6c1.1.3 4.8.8 4.2 2.9zm.5-5.3c-.5 1.9-3.4.9-4.3.7l.8-3.3c.9.2 4 .6 3.5 2.6z"
          />
        </>
      );
    case "ETH":
      return (
        <>
          <circle cx="16" cy="16" r="16" fill="#627EEA" />
          <path fill="#FFF" fillOpacity=".6" d="M16.5 5v8.2l6.9 3.1z" />
          <path fill="#FFF" d="M16.5 5 9.6 16.3l6.9-3.1z" />
          <path fill="#FFF" fillOpacity=".6" d="M16.5 22.1v5L23.4 18z" />
          <path fill="#FFF" d="M16.5 27.1v-5L9.6 18z" />
          <path fill="#FFF" fillOpacity=".2" d="M16.5 20.8 23.4 16.3 16.5 13.2z" />
          <path fill="#FFF" fillOpacity=".6" d="M9.6 16.3 16.5 20.8V13.2z" />
        </>
      );
    case "SOL":
      return (
        <>
          <circle cx="16" cy="16" r="16" fill="#000" />
          <path
            fill={`url(#${gid}sol)`}
            d="M9.4 20.2c.2-.2.4-.2.6-.2h12.7c.4 0 .6.4.3.7l-2.5 2.5c-.2.2-.4.2-.6.2H7.2c-.4 0-.6-.4-.3-.7z"
          />
          <path
            fill={`url(#${gid}sol)`}
            d="M9.4 9.3c.2-.2.4-.2.6-.2h12.7c.4 0 .6.4.3.7l-2.5 2.5c-.2.2-.4.2-.6.2H7.2c-.4 0-.6-.4-.3-.7z"
          />
          <path
            fill={`url(#${gid}sol)`}
            d="M22.6 14.6c-.2-.2-.4-.2-.6-.2H9.3c-.4 0-.6.4-.3.7l2.5 2.5c.2.2.4.2.6.2h12.7c.4 0 .6-.4.3-.7z"
          />
          <defs>
            <linearGradient id={`${gid}sol`} x1="8" y1="24" x2="24" y2="10" gradientUnits="userSpaceOnUse">
              <stop stopColor="#00FFA3" />
              <stop offset="1" stopColor="#DC1FFF" />
            </linearGradient>
          </defs>
        </>
      );
    case "DOGE":
      return (
        <>
          <circle cx="16" cy="16" r="16" fill="#C2A633" />
          <path
            fill="#FFF"
            d="M16.4 8.2h-5.2v15.6h5.5c3.9 0 6.5-2 6.5-5.4 0-2.1-1.1-3.7-2.8-4.4 1.4-.8 2.3-2.2 2.3-4 0-2.8-2.3-4.8-6.3-4.8zm-.4 6.3h-2.3V10.7h2.4c1.8 0 2.8.8 2.8 1.9 0 1.3-1.1 1.9-2.9 1.9zm.4 7h-2.7v-4.5h2.6c2 0 3.1.8 3.1 2.2s-1.1 2.3-3 2.3z"
          />
        </>
      );
    case "BNB":
      return (
        <>
          <circle cx="16" cy="16" r="16" fill="#F3BA2F" />
          <path
            fill="#FFF"
            d="M12.1 14.5 16 10.6l3.9 3.9 2.3-2.3L16 6l-6.2 6.2zm-2.2 3.8L12.2 16l-2.3-2.3L7.6 16zm6.1 6.1 3.9-3.9-2.3-2.3-1.6 1.6-1.6-1.6-2.3 2.3zm6.1-6.1L22.4 16l2.3-2.3L27 16zM16 17.8l1.6-1.6 2.3 2.3L16 22.4l-3.9-3.9 2.3-2.3z"
          />
        </>
      );
    default:
      return (
        <>
          <circle cx="16" cy="16" r="16" fill="#111" />
          <text
            x="16"
            y="21"
            textAnchor="middle"
            fill="#FFF"
            fontSize="14"
            fontWeight="700"
            fontFamily="var(--font-plex), ui-monospace, monospace"
          >
            {id.slice(0, 1)}
          </text>
        </>
      );
  }
}
