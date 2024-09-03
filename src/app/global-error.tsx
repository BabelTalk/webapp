"use client";

import { motion } from "framer-motion";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        className={
          "min-h-screen flex items-center justify-center dark:bg-gray-900 bg-gray-100"
        }
      >
        <div className="text-center">
          <motion.h1
            className={
              "text-4xl font-bold mb-4 dark:text-viridian-300 text-viridian-700"
            }
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            Oops! Something went wrong
          </motion.h1>
          <motion.p
            className={"text-xl mb-8 dark:text-gray-300 text-gray-700"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            We&apos;re sorry, but an error occurred. Please try again.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          ></motion.div>
          <motion.button
            className={
              "px-4 py-2 rounded dark:bg-viridian-600 dark:hover:bg-viridian-700 dark:text-white bg-viridian-500 hover:bg-viridian-600 text-white"
            }
            onClick={reset}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Try again
          </motion.button>
        </div>
      </body>
    </html>
  );
}
