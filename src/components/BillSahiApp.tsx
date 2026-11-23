"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prepareImage } from "@/lib/image";
import { BillSchema, type Bill } from "@/lib/schema";
import { Result, type Meta } from "./Result";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; preview: string }
  | { kind: "result"; bill: Bill; original: Bill; meta: Meta; preview: string | null }
  | { kind: "error"; message: string };

const SAMPLES = [
  { slug: "restaurant", label: "Restaurant", tilt: "-rotate-3" },
  { slug: "medical", label: "Medical store", tilt: "rotate-2" },
  { slug: "kirana", label: "Kirana store", tilt: "-rotate-1" },
];

const READING_LINES = [
  "Reading every line…",
  "Copying numbers exactly as printed…",
  "Redoing the math…",
  "Checking GST and charges…",
];

export function BillSahiApp({ repoUrl }: { repoUrl: string | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const analyze = useCallback(async (dataUrl: string, mimeType: string, sampleSlug?: string) => {
    setPhase({ kind: "reading", preview: dataUrl });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: dataUrl, mimeType }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Something went wrong while checking this bill.");
      const bill = BillSchema.parse(json.bill);
      setPhase({ kind: "result", bill, original: bill, meta: json.meta, preview: dataUrl });
    } catch (e) {
      const message = (e as Error).message || "Something went wrong while checking this bill.";
      if (sampleSlug) {
        const saved = await loadSaved(sampleSlug).catch(() => null);
        if (saved) {
          setPhase({
            kind: "result",
            bill: saved,
            original: saved,
            meta: { source: "saved", note: message },
            preview: dataUrl,
          });
          return;
        }
      }
      setPhase({ kind: "error", message });
    }
  }, []);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const { dataUrl, mimeType } = await prepareImage(file);
        await analyze(dataUrl, mimeType);
      } catch {
        setPhase({
          kind: "error",
          message: "Couldn't open that photo. Try a JPG, a PNG, or a screenshot of the bill.",
        });
      }
    },
    [analyze],
  );

  const onSample = useCallback(
    async (slug: string) => {
      const imageUrl = `/samples/${slug}.jpg`;
      setPhase({ kind: "reading", preview: imageUrl });
      try {
        const blob = await fetch(imageUrl).then((r) => {
          if (!r.ok) throw new Error(`sample ${r.status}`);
          return r.blob();
        });
        const { dataUrl, mimeType } = await prepareImage(blob);
        await analyze(dataUrl, mimeType, slug);
      } catch (e) {
        const saved = await loadSaved(slug).catch(() => null);
        if (saved) {
          setPhase({
            kind: "result",
            bill: saved,
            original: saved,
            meta: { source: "saved", note: (e as Error).message },
            preview: imageUrl,
          });
        } else {
          setPhase({ kind: "error", message: "Couldn't load that sample bill. Try uploading a photo instead." });
        }
      }
    },
    [analyze],
  );

  // ?sample=restaurant&saved=1 opens a sample's saved reading without calling the AI.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const slug = q.get("sample");
    if (!slug || !SAMPLES.some((s) => s.slug === slug)) return;
    const t = setTimeout(() => {
      if (q.get("saved") === "1") {
        loadSaved(slug).then((bill) =>
          setPhase({ kind: "result", bill, original: bill, meta: { source: "saved" }, preview: `/samples/${slug}.jpg` }),
        );
      } else {
        onSample(slug);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [onSample]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase.kind]);

  const reset = () => setPhase({ kind: "idle" });

  return (
    <main className="mx-auto w-full max-w-[460px] px-5 pb-14 pt-7">
      <header className="no-print mb-8 flex items-baseline justify-between">
        <button onClick={reset} className="text-[28px] font-extrabold leading-none tracking-tight text-white">
          Bill<span className="text-marker">Sahi</span>
        </button>
        <span className="text-[15px] text-white/60" lang="hi">
          बिल सही है?
        </span>
      </header>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {phase.kind === "idle" && (
        <Intro onCamera={() => cameraRef.current?.click()} onGallery={() => galleryRef.current?.click()} onSample={onSample} />
      )}

      {phase.kind === "reading" && <Reading preview={phase.preview} />}

      {phase.kind === "result" && (
        <Result
          bill={phase.bill}
          original={phase.original}
          meta={phase.meta}
          preview={phase.preview}
          onChange={(bill) => setPhase({ ...phase, bill })}
          onReset={reset}
        />
      )}

      {phase.kind === "error" && (
        <section className="paper-wrap">
          <div className="paper">
            <h1 className="text-[26px] font-bold leading-tight text-gadbad">That didn&apos;t work</h1>
            <p className="mt-2 text-[17px] leading-snug text-ink">{phase.message}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={() => galleryRef.current?.click()} className="btn-ink">
                Try another photo
              </button>
              <button onClick={reset} className="btn-line">
                Use a sample bill
              </button>
            </div>
          </div>
        </section>
      )}

      <HowItWorks />

      <footer className="no-print mt-10 text-[14px] leading-relaxed text-white/55">
        Made in Mumbai by Sanket Gupta.
        {repoUrl && (
          <>
            {" "}
            <a href={repoUrl} className="underline decoration-white/30 underline-offset-4 hover:text-white">
              Source on GitHub
            </a>
            .
          </>
        )}
      </footer>
    </main>
  );
}

async function loadSaved(slug: string): Promise<Bill> {
  const json = await fetch(`/samples/${slug}.json`).then((r) => r.json());
  return BillSchema.parse(json);
}

function Intro({
  onCamera,
  onGallery,
  onSample,
}: {
  onCamera: () => void;
  onGallery: () => void;
  onSample: (slug: string) => void;
}) {
  return (
    <section>
      <h1 className="text-[44px] font-extrabold leading-[0.98] tracking-tight">Is your bill sahi?</h1>
      <p className="mt-3 max-w-[34ch] text-[18px] leading-snug text-white/80">
        Snap any bill: restaurant, medical store, kirana, electricity. AI reads every line, then BillSahi redoes the
        math.
      </p>

      <div className="paper-wrap mt-7">
        <div className="paper">
          <button onClick={onCamera} className="btn-ink w-full justify-center py-4 text-[19px]">
            <CameraIcon /> Take a photo of your bill
          </button>
          <button onClick={onGallery} className="btn-line mt-3 w-full justify-center py-3 text-[17px]">
            Upload from gallery
          </button>
          <p className="mt-4 text-center text-[13.5px] leading-snug text-ink-soft">
            Photos go to Google Gemini to be read. BillSahi doesn&apos;t store them.
          </p>
        </div>
      </div>

      <h2 className="mt-10 text-[19px] font-semibold text-white">No bill handy? Try one of these.</h2>
      <ul className="mt-4 grid grid-cols-3 gap-4">
        {SAMPLES.map((s) => (
          <li key={s.slug}>
            <button
              onClick={() => onSample(s.slug)}
              className={`group block w-full ${s.tilt} transition-transform hover:rotate-0 focus-visible:rotate-0`}
              aria-label={`Check the sample ${s.label.toLowerCase()} bill`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/samples/${s.slug}.jpg`}
                alt=""
                className="aspect-[3/4] w-full rounded-[3px] object-cover object-top shadow-[0_8px_16px_rgb(8_12_48/0.45)]"
              />
              <span className="mt-2 block text-[15px] font-medium text-white/85 group-hover:text-white">{s.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Reading({ preview }: { preview: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % READING_LINES.length), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <section aria-live="polite">
      <h1 className="text-[34px] font-extrabold leading-tight">{READING_LINES[i]}</h1>
      <div className="relative mt-6 overflow-hidden rounded-[4px] shadow-[0_12px_24px_rgb(8_12_48/0.5)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="Your bill" className="max-h-[62vh] w-full object-cover object-top opacity-90" />
        <div className="scanline" />
      </div>
      <p className="mt-4 text-[15px] text-white/65">Usually takes 5–15 seconds.</p>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="no-print mt-14 border-t border-white/15 pt-8">
      <h2 className="text-[24px] font-bold leading-tight">AI reads. Code checks.</h2>
      <ol className="mt-4 space-y-4 text-[16.5px] leading-snug text-white/80">
        <li className="flex gap-3">
          <span className="mt-0.5 font-mono text-[14px] text-marker">1</span>
          <span>Gemini reads the photo and copies every number exactly as printed. It&apos;s told never to fix anything, even a wrong total.</span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 font-mono text-[14px] text-marker">2</span>
          <span>Plain arithmetic redoes the bill: line totals, MRP, service charge, GST split, round-off, even the GSTIN&apos;s check digit.</span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 font-mono text-[14px] text-marker">3</span>
          <span>The verdict comes from those checks, not from AI&apos;s opinion. Fix any misread number and it re-checks instantly.</span>
        </li>
      </ol>
    </section>
  );
}

function CameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.2-1.8A1.5 1.5 0 0 1 10.55 3.5h2.9a1.5 1.5 0 0 1 1.25.7L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12.5" r="3.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
