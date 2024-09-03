import { useEffect, useRef, useState } from "react";
import { MotionValue, SpringOptions, useSpring } from "framer-motion";

export function useAnimatedText(target: number, transition: SpringOptions) {
  const ref = useRef<HTMLDivElement>(null);
  const value = useSpring(200, transition);
  const [isOn, setIsOn] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsOn(false);
    }, 500);

    ref.current!.innerText = Math.trunc(target).toString();

    return value.onChange((v) => {
      ref.current!.innerText = Math.trunc(v).toString();
      clearTimeout(timer);
    });
  });
  useEffect(() => value.set(target), [target, value]);

  return { ref, isOn };
}
