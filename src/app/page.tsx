"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Video,
  Mic,
  MessageSquare,
  Clock,
  Sliders,
  MonitorUp,
  Users,
  Globe,
  Zap,
  ScrollText,
} from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export default function Home() {
  const fadeIn = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
  };

  const stagger = {
    visible: {
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-purple-50 to-white dark:from-gray-900 dark:to-gray-800">
      <header className="px-4 lg:px-6 h-14 flex items-center border-b">
        <Link className="flex items-center justify-center" href="/">
          <Video className="h-6 w-6 text-purple-600" />
          <span className="ml-2 text-2xl font-bold text-purple-600">
            Nextalk
          </span>
        </Link>
        <nav className="ml-auto flex gap-4 sm:gap-6">
          <Link
            className="text-sm font-medium hover:text-purple-600 transition-colors"
            href="#features"
          >
            Features
          </Link>
          <Link
            className="text-sm font-medium hover:text-purple-600 transition-colors"
            href="#how-it-works"
          >
            How It Works
          </Link>
          <Link
            className="text-sm font-medium hover:text-purple-600 transition-colors"
            href="#benefits"
          >
            Benefits
          </Link>
        </nav>
      </header>
      <main className="flex-1">
        <section className="w-full py-12 md:py-24 lg:py-32 xl:py-48 bg-purple-100 dark:bg-purple-900">
          <div className="container px-4 md:px-6">
            <motion.div
              className="flex flex-col items-center space-y-4 text-center"
              initial="hidden"
              animate="visible"
              variants={stagger}
            >
              <motion.h1
                className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl/none text-purple-800 dark:text-purple-100"
                variants={fadeIn}
              >
                Nextalk: Where Conversations <br className="hidden sm:inline" />
                Become Productivity
              </motion.h1>
              <motion.p
                className="mx-auto max-w-[700px] text-gray-500 md:text-xl dark:text-gray-400"
                variants={fadeIn}
              >
                Elevate your meetings with AI-powered transcription,
                translation, and summaries. Just talk, and let Nextalk handle
                the rest.
              </motion.p>
              <motion.div
                className="flex flex-wrap justify-center gap-4"
                variants={fadeIn}
              >
                <Button
                  size="lg"
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  Get Started for Free
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-purple-600 text-purple-600 hover:bg-purple-100"
                >
                  Learn More
                </Button>
              </motion.div>
            </motion.div>
          </div>
          <motion.div
            className="absolute top-1/2 left-4 transform -translate-y-1/2"
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5, duration: 0.5 }}
          >
            <Users className="h-16 w-16 text-purple-500 opacity-50" />
          </motion.div>
          <motion.div
            className="absolute top-1/4 right-4 transform -translate-y-1/2"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.7, duration: 0.5 }}
          >
            <Globe className="h-20 w-20 text-purple-400 opacity-50" />
          </motion.div>
          <motion.div
            className="absolute bottom-1/4 left-1/4 transform -translate-x-1/2"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.5 }}
          >
            <Zap className="h-12 w-12 text-purple-300 opacity-50" />
          </motion.div>
        </section>
        <motion.section
          id="features"
          className="w-full py-12 md:py-24 lg:py-32 bg-white dark:bg-gray-800"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
        >
          <div className="container px-4 md:px-6">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl text-center mb-12 text-purple-800 dark:text-purple-100">
              Key Features
            </h2>
            <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-3">
              {[
                {
                  icon: Mic,
                  title: "AI Transcription",
                  description:
                    "Generate accurate meeting transcripts automatically",
                },
                {
                  icon: MessageSquare,
                  title: "Speech Translation",
                  description: "Real-time captions in multiple languages",
                },
                {
                  icon: ScrollText,
                  title: "Meeting Summaries",
                  description: "AI-generated summaries of your discussions",
                },
                {
                  icon: Clock,
                  title: "Break Reminders",
                  description:
                    "Stay productive with timely break notifications",
                },
                {
                  icon: Sliders,
                  title: "Manual Bitrate",
                  description:
                    "Apart from adaptive bitrate, you can also manually set it",
                },
                {
                  icon: MonitorUp,
                  title: "Screen Sharing",
                  description: "Easy screen sharing and recording",
                },
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  className="flex flex-col items-center space-y-3 text-center"
                  variants={fadeIn}
                >
                  <feature.icon className="h-12 w-12 text-purple-600" />
                  <h3 className="text-xl font-bold text-purple-800 dark:text-purple-100">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {feature.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>
        <motion.section
          id="how-it-works"
          className="w-full py-12 md:py-24 lg:py-32 bg-purple-50 dark:bg-gray-900"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
        >
          <div className="container px-4 md:px-6">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl text-center mb-12 text-purple-800 dark:text-purple-100">
              How It Works
            </h2>
            <div className="grid gap-10 md:grid-cols-3">
              {[
                {
                  step: 1,
                  title: "Start Your Meeting",
                  description: "Create or join a meeting with a single click",
                },
                {
                  step: 2,
                  title: "Just Talk",
                  description:
                    "Focus on your conversation, Nextalk handles the rest",
                },
                {
                  step: 3,
                  title: "Review and Share",
                  description:
                    "Access transcripts, translations, and summaries instantly",
                },
              ].map((item, index) => (
                <motion.div
                  key={index}
                  className="flex flex-col items-center space-y-3 text-center"
                  variants={fadeIn}
                >
                  <motion.div
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 text-white"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    {item.step}
                  </motion.div>
                  <h3 className="text-xl font-bold text-purple-800 dark:text-purple-100">
                    {item.title}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {item.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>
        <motion.section
          id="benefits"
          className="w-full py-12 md:py-24 lg:py-32 bg-white dark:bg-gray-800"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
        >
          <div className="container px-4 md:px-6">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl text-center mb-12 text-purple-800 dark:text-purple-100">
              Benefits for Your Team
            </h2>
            <div className="grid gap-10 sm:grid-cols-2">
              {[
                {
                  title: "Increased Productivity",
                  description:
                    "With AI-powered transcription and summaries, your team can focus on discussions rather than note-taking.",
                },
                {
                  title: "Improved Collaboration",
                  description:
                    "Persistent chat and easy screen sharing make it simple for team members to stay connected and share ideas.",
                },
                {
                  title: "Better Accessibility",
                  description:
                    "Real-time translations and captions ensure that language barriers don't hinder communication.",
                },
                {
                  title: "Effortless Documentation",
                  description:
                    "Automatically generated transcripts and summaries make it easy to review and share meeting outcomes.",
                },
              ].map((benefit, index) => (
                <motion.div
                  key={index}
                  className="flex flex-col space-y-3"
                  variants={fadeIn}
                >
                  <h3 className="text-xl font-bold text-purple-800 dark:text-purple-100">
                    {benefit.title}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {benefit.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>
        <motion.section
          className="w-full py-12 md:py-24 lg:py-32 bg-purple-100 dark:bg-purple-900"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
        >
          <div className="container px-4 md:px-6">
            <motion.div
              className="flex flex-col items-center space-y-4 text-center"
              variants={fadeIn}
            >
              <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl text-purple-800 dark:text-purple-100">
                Ready to Transform Your Meetings?
              </h2>
              <p className="mx-auto max-w-[600px] text-gray-500 md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed dark:text-gray-400">
                Join thousands of teams already using Nextalk to boost their
                productivity and collaboration.
              </p>
              <div className="w-full max-w-sm space-y-2">
                <form className="flex space-x-2">
                  <Input
                    className="max-w-lg flex-1"
                    placeholder="Enter your email"
                    type="email"
                  />
                  <Button
                    type="submit"
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    Get Started
                  </Button>
                </form>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Start your free trial. No credit card required.
                </p>
              </div>
            </motion.div>
          </div>
        </motion.section>
      </main>
      <footer className="flex flex-col gap-2 sm:flex-row py-6 w-full shrink-0 items-center px-4 md:px-6 border-t">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          © 2023 Nextalk. All rights reserved.
        </p>
        <nav className="sm:ml-auto flex gap-4 sm:gap-6">
          <Link className="text-xs hover:underline underline-offset-4" href="#">
            Terms of Service
          </Link>
          <Link className="text-xs hover:underline underline-offset-4" href="#">
            Privacy
          </Link>
        </nav>
      </footer>
    </div>
  );
}
