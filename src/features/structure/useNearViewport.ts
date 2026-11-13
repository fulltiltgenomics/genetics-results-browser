import { useEffect, useState, type RefObject } from "react";

// a browser keeps only so many WebGL contexts alive (16 in Chromium) and silently drops the
// oldest, so a long transcript holds one only for the viewers around the viewport: built when
// within NEAR of it, released when further than FAR. The gap keeps a viewer at the edge from
// being rebuilt on every small scroll
const NEAR = "300px";
const FAR = "1500px";
const SETTLE_MS = 250;

/** `near`: within NEAR of the viewport now; `seen`: has been at least once. */
export const useNearViewport = (ref: RefObject<HTMLElement | null>) => {
  // no observer (an old browser, jsdom): behave as if always on screen
  const supported = typeof IntersectionObserver !== "undefined";
  const [near, setNear] = useState(!supported);
  const [seen, setSeen] = useState(!supported);
  useEffect(() => {
    const el = ref.current;
    if (!supported || !el) return;
    // a transcript that opens by scrolling to its end carries every viewer through the
    // viewport once; only one that stays near it for a moment counts
    let settle: ReturnType<typeof setTimeout> | undefined;
    const enter = new IntersectionObserver(
      ([entry]) => {
        clearTimeout(settle);
        if (!entry.isIntersecting) return;
        settle = setTimeout(() => {
          setNear(true);
          setSeen(true);
        }, SETTLE_MS);
      },
      { rootMargin: NEAR },
    );
    const leave = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) setNear(false);
      },
      { rootMargin: FAR },
    );
    enter.observe(el);
    leave.observe(el);
    return () => {
      clearTimeout(settle);
      enter.disconnect();
      leave.disconnect();
    };
  }, [ref, supported]);
  return { near, seen };
};
