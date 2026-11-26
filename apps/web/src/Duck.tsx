import { useEffect, useRef } from "react";

/**
 * Pato, the talking avatar: one photo with the beak closed, and an open-beak patch on top.
 * The beak follows the loudness of the character's voice. No 3D, no lip-sync model.
 */
export function Duck({ level, state }: { level: () => number; state: "idle" | "talking" | "listening" | "hearing" | "thinking" }) {
  const mouth = useRef<HTMLImageElement>(null);
  useEffect(() => {
    let raf = 0;
    let openUntil = 0;
    const loop = (t: number) => {
      let l = level();
      // browser voices give no audio to measure: flap at a talking pace instead
      if (!l && typeof speechSynthesis !== "undefined" && speechSynthesis.speaking) l = Math.sin(t / 55) > 0 ? 0.5 : 0;
      if (l > 0.06) openUntil = t + 70; // hold briefly so the beak doesn't flicker
      if (mouth.current) mouth.current.style.opacity = t < openUntil ? "1" : "0";
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [level]);
  return (
    <div className={`duck ${state}`} aria-label="Pato">
      <img src={`${import.meta.env.BASE_URL}pato/closed.jpg`} alt="" draggable={false} />
      <img ref={mouth} className="mouth" src={`${import.meta.env.BASE_URL}pato/mouth-open.png`} alt="" draggable={false} />
    </div>
  );
}
