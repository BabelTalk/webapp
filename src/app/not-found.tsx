"use client";

import { useAnimatedText } from "@/lib/hooks/use-animated-text";
import { motion, MotionConfig } from "framer-motion";
import Link from "next/link";

export default function NotFound() {
  const transition = {
    type: "spring",
    mass: 1,
    stiffness: 100,
  };
  const { ref, isOn } = useAnimatedText(404, transition);
  return (
    <MotionConfig transition={transition}>
      <motion.div
        className=""
        initial={false}
        animate={{
          backgroundColor: "#ff2558",
          color: "#c70f46",
        }}
      >
        <div className="w-screen flex-col justify-center items-center flex h-screen">
          <motion.h1 ref={ref} className="font-extrabold text-9xl" />
          <motion.h2
            className="text-3xl font-semibold mb-4 text-viridian-600 dark:text-viridian-400"
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            Page Not Found
          </motion.h2>
          <motion.p
            className="text-xl mb-8 text-gray-700 dark:text-gray-300"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          >
            Oops! The page you&apos;re looking for doesn&apos;t exist.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.5 }}
          >
            <Link
              href="/"
              className="inline-block z-20 px-6 py-3 rounded-full text-lg font-semibold bg-viridian-500 hover:bg-viridian-600 text-white dark:bg-viridian-600 dark:hover:bg-viridian-700"
            >
              Go Back Home
            </Link>
          </motion.div>
        </div>
      </motion.div>
    </MotionConfig>
  );
}
