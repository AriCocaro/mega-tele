"use client";

import { useEffect, useRef, useState } from "react";

type Video = { id: string; name: string };

// 👇 pegá tu clave acá, entre las comillas
const API_KEY = "AIzaSyBHMZUxLOqfa42iwh0UxYpPYQ_LNvgeyXM";

// carpeta de Drive con los videos
const FOLDER_ID = "1dbYtcSPNqWAq4Xqo2euKXIIDd_-dC8mI";

// true = muestra errores en pantalla (útil para diagnosticar). Cuando todo ande, ponelo en false.
const DEBUG = true;

// cada cuánto vuelve a consultar la carpeta (30 min)
const REFRESH_MS = 30 * 60 * 1000;

const videoUrl = (id: string) =>
  `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${API_KEY}`;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// lista todos los videos de la carpeta (maneja carpetas con más de 1000 archivos)
async function fetchFolderVideos(): Promise<Video[]> {
  const out: Video[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${FOLDER_ID}' in parents and mimeType contains 'video/' and trashed = false`,
      fields: "nextPageToken, files(id,name)",
      pageSize: "1000",
      key: API_KEY,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        `HTTP ${res.status} ${body?.error?.errors?.[0]?.reason ?? ""}`
      );
    }
    const data = await res.json();
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return out;
}

export default function FullscreenPlayer() {
  const [queue, setQueue] = useState<Video[]>([]);
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [log, setLog] = useState("Cargando carpeta…");
  const catalog = useRef<Video[]>([]); // última lista conocida de la carpeta
  const errors = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // carga la carpeta al abrir la página y la refresca cada 30 minutos
  useEffect(() => {
    let cancelled = false;

    const load = async (first: boolean) => {
      try {
        const list = await fetchFolderVideos();
        if (cancelled) return;
        if (list.length === 0) {
          if (first)
            setLog(
              "No se encontraron videos en la carpeta (revisá que esté compartida con 'Cualquier persona con el enlace')"
            );
          return;
        }
        catalog.current = list;
        if (first) {
          setLog("");
          setQueue(shuffle(list)); // mezcla solo en el navegador
        }
      } catch (e) {
        if (first) setLog(`No se pudo leer la carpeta: ${(e as Error).message}`);
      }
    };

    load(true);
    const t = setInterval(() => load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const current = queue[index];

  // arranca solo: intenta con sonido; si el navegador lo bloquea, reintenta en silencio
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !current) return;
    v.muted = muted;
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      v.play().catch(() => {});
    });
  }, [current, muted]);

  const next = () => {
    if (index + 1 >= queue.length) {
      setQueue(shuffle(catalog.current)); // nueva mezcla con la lista actualizada
      setIndex(0);
    } else {
      setIndex((i) => i + 1);
    }
  };

  const handleError = async (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const code = e.currentTarget.error?.code ?? "?";
    const failed = current;
    let detail = "";

    // consulta a Drive el motivo real del fallo (pide solo 1 byte)
    try {
      const res = await fetch(videoUrl(failed.id), {
        headers: { Range: "bytes=0-0" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        detail = ` | HTTP ${res.status} ${body?.error?.errors?.[0]?.reason ?? ""}`;
      } else {
        detail = " | Drive responde bien: probable códec no compatible";
      }
    } catch {
      detail = " | no se pudo consultar (mirá la pestaña Network)";
    }

    setLog(`Error ${code} en "${failed.name}"${detail}`);
    errors.current += 1;
    if (errors.current < queue.length) next(); // evita bucle infinito
  };

  if (API_KEY === "PEGAR_ACA_TU_API_KEY") {
    return (
      <p style={{ color: "#fff", padding: 16 }}>
        Falta pegar la API key en components/FullscreenPlayer.tsx
      </p>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      {current && (
        <video
          ref={videoRef}
          key={current.id}
          src={videoUrl(current.id)}
          playsInline
          preload="auto"
          onPlaying={() => {
            errors.current = 0;
          }}
          onEnded={next}
          onError={handleError}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      )}

      {muted && (
        <button
          onClick={() => setMuted(false)}
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            opacity: 0.5,
            padding: "8px 12px",
            cursor: "pointer",
          }}
        >
          🔇 Activar sonido
        </button>
      )}

      {DEBUG && log && (
        <p
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            right: 8,
            color: "#f88",
            margin: 0,
            fontFamily: "sans-serif",
          }}
        >
          {log}
        </p>
      )}
    </div>
  );
}