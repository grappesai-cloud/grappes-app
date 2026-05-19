import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";
export default function AnimatedNumber({
  value,
  duration = 1.2,
  className,
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const mv = useMotionValue(0);
  const spring = useSpring(mv, {
    duration: duration * 1000,
    bounce: 0,
  });
  const display = useTransform(spring, (v) => Math.round(v).toString());
  useEffect(() => {
    mv.set(value);
  }, [mv, value]);
  return <motion.span className={className}>{display}</motion.span>;
}
