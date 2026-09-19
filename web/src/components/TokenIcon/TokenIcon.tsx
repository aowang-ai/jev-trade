"use client";

import { useId } from "react";
import { displayCoin } from "@/lib/format";
import styles from "./TokenIcon.module.css";

const OFFICIAL: Record<string, string> = {
  DOGE: "/tokens/doge.png",
  BNB: "/tokens/bnb.png",
};

export default function TokenIcon({ coin, size = 16 }: { coin: string; size?: number }) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = displayCoin(coin).toUpperCase();
  const src = OFFICIAL[id];
  if (src) {
    return (
      <img
        className={styles.icon}
        src={src}
        alt=""
        width={size}
        height={size}
        draggable={false}
      />
    );
  }
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
