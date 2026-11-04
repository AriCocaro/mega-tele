"use client";

import { useEffect, useRef, useState } from "react";

type Video = { id: string; name: string };

// 👇 pegá tu clave acá, entre las comillas
const API_KEY: string = "AIzaSyBHMZUxLOqfa42iwh0UxYpPYQ_LNvgeyXM";

// carpeta de Drive con los videos
const FOLDER_ID = "1dbYtcSPNqWAq4Xqo2euKXIIDd_-dC8mI";

// true = muestra mensajes de error en pantalla. Cuando todo ande, ponelo en false.
const DEBUG: boolean = true;

// true = guarda cada video en el navegador para bajarlo una sola vez de Drive.
// false = reproduce directo desde Drive (probar en la tele si da "Failed to fetch").
const USE_CACHE: boolean = true;

// cada cuánto vuelve a consultar la carpeta (30 min)
const REFRESH_MS = 30 * 60 * 1000;

// imagen que se ve entre video y video (archivo dentro de la carpeta public)
const BACKGROUND_IMAGE = "/fondo.jpg";

const CACHE_NAME = "videos-v1";

const videoUrl = (id: string) =>
  `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${API_KEY}`;

const cacheKey = (id: string) => `/video-cache/${id}`;

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

// baja el video completo desde Drive
async function download(id: string): Promise<Blob> {
  const res = await fetch(videoUrl(id));
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      `HTTP ${res.status} ${body?.error?.errors?.[0]?.reason ?? ""}`
    );
  }
  const blob = await res.blob();
  if (/^(text|application\/json)/.test(blob.type)) {
    throw new Error("Drive no devolvió un video");
  }
  return blob;
}

// primero busca en el caché del navegador; si no está, lo baja de Drive y lo guarda
async function loadBlobUncached(id: string): Promise<Blob> {
  if (typeof caches === "undefined") return download(id);

  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(cacheKey(id));
  if (hit) return hit.blob();

  const blob = await download(id);
  try {
    await cache.put(
      cacheKey(id),
      new Response(blob, {
        headers: { "Content-Type": blob.type || "video/mp4" },
      })
    );
  } catch {
    /* sin espacio para guardarlo: igual se reproduce */
  }
  return blob;
}

// evita bajar dos veces el mismo video si se pide mientras ya se está bajando
const inflight = new Map<string, Promise<Blob>>();
function loadBlob(id: string): Promise<Blob> {
  let p = inflight.get(id);
  if (!p) {
    p = loadBlobUncached(id).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

// borra del caché los videos que ya no están en la carpeta
async function cleanCache(list: Video[]) {
  if (typeof caches === "undefined") return;
  const cache = await caches.open(CACHE_NAME);
  const keep = new Set(list.map((v) => cacheKey(v.id)));
  for (const req of await cache.keys()) {
    if (!keep.has(new URL(req.url).pathname)) await cache.delete(req);
  }
}

export default function FullscreenPlayer() {
  const [queue, setQueue] = useState<Video[]>([]);
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [log, setLog] = useState("Cargando carpeta…");
  const [src, setSrc] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
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
        if (USE_CACHE) cleanCache(list).catch(() => {});
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

  const next = () => {
    if (index + 1 >= queue.length) {
      setQueue(shuffle(catalog.current)); // nueva mezcla con la lista actualizada
      setIndex(0);
    } else {
      setIndex((i) => i + 1);
    }
  };

  // prepara el video actual (del caché o de Drive) y precarga el siguiente
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);

    if (!USE_CACHE) {
      setSrc(videoUrl(current.id)); // reproducción directa desde Drive
      return;
    }

    loadBlob(current.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);

        const upcoming = queue[(index + 1) % queue.length];
        if (upcoming && upcoming.id !== current.id) {
          loadBlob(upcoming.id).catch(() => {});
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        // no se pudo bajar/guardar completo: lo reproduce directo desde Drive
        setLog(
          `Sin caché para "${current.name}" (${e.message}), reproduciendo directo`
        );
        setSrc(videoUrl(current.id));
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // arranca solo: intenta con sonido; si el navegador lo bloquea, reintenta en silencio
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    v.muted = muted;
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      v.play().catch(() => {});
    });
  }, [src, muted]);

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const code = e.currentTarget.error?.code ?? "?";
    setLog(
      `Error ${code} en "${current?.name}": el archivo no se pudo reproducir (límite de Drive o códec no compatible)`
    );
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        backgroundImage: `url(${BACKGROUND_IMAGE})`,
        backgroundSize: "contain",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      {current && src && (
        <video
          ref={videoRef}
          key={current.id}
          src={src}
          playsInline
          preload="auto"
          loop={queue.length === 1}
          onPlaying={() => {
            errors.current = 0;
            setLog("");
            setPlayingId(current.id); // recién ahora se muestra el video
          }}
          onEnded={next}
          onError={handleError}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "#000",
            opacity: playingId === current.id ? 1 : 0,
            transition: "opacity 0.3s",
          }}
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