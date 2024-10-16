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
  FileText,
  Puzzle,
  Rocket,
  Languages,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import {
  motion,
  useScroll,
  useTransform,
  AnimatePresence,
} from "framer-motion";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export default function Home() {
  const { scrollYProgress } = useScroll();
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.8]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user, error, isLoading } = useUser();
  const fadeInUp = {
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

  const scaleOnHover = {
    hover: { scale: 1.05, transition: { duration: 0.2 } },
  };

  const menuVariants = {
    closed: { opacity: 0, x: "-100%" },
    open: {
      opacity: 1,
      x: 0,
      transition: { type: "spring", stiffness: 100, damping: 20 },
    },
  };

  return (
    <div className="flex flex-col min-w-screen min-h-screen bg-gradient-to-b from-primary-50 to-white dark:from-gray-950 dark:to-gray-900 overflow-x-hidden">
      <motion.header
        className="px-4 lg:px-6 h-14 flex items-center border-b border-primary-200 dark:border-gray-800 sticky top-0 z-50 bg-white dark:bg-gray-950"
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 100 }}
      >
        <Link className="flex items-center justify-center" href="/">
          <Video className="h-6 w-6 text-primary-600 dark:text-primary-400" />
          <motion.span
            className="ml-2 text-2xl font-bold text-primary-600 dark:text-primary-400"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            BabelTalk
          </motion.span>
        </Link>
        <nav className="ml-auto hidden md:flex gap-4 sm:gap-6">
          {["Features", "How It Works", "Benefits"].map((item) => (
            <motion.div key={item} whileHover="hover" variants={scaleOnHover}>
              <Link
                className="text-sm font-medium hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                href={`#${item.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {item}
              </Link>
            </motion.div>
          ))}
        </nav>
        {isLoading ? (
          <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse mx-2"></div>
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Avatar className="w-8 h-8 cursor-pointer mx-2">
                <AvatarImage src={user.picture || ""} alt={user.name || ""} />
                <AvatarFallback>{user.name?.charAt(0) || "U"}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Link href="/dashboard">Dashboard</Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link href="/api/auth/logout">
                  <div className="flex items-center">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </div>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button asChild className="mx-2">
            <Link href="/api/auth/login">Log in</Link>
          </Button>
        )}
        <motion.button
          className="ml-auto md:hidden"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          {isMenuOpen ? <X /> : <Menu />}
        </motion.button>
      </motion.header>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.nav
            className="fixed inset-0 bg-white dark:bg-gray-900 z-40 flex flex-col items-center justify-center"
            initial="closed"
            animate="open"
            exit="closed"
            variants={menuVariants}
          >
            {["Features", "How It Works", "Benefits"].map((item) => (
              <motion.div
                key={item}
                whileHover="hover"
                variants={scaleOnHover}
                className="my-4"
              >
                <Link
                  className="text-2xl font-medium hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  href={`#${item.toLowerCase().replace(/\s+/g, "-")}`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {item}
                </Link>
              </motion.div>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
      <main className="flex-1">
        <section className="w-full py-12 md:py-24 lg:py-32 xl:py-48 bg-primary-100 dark:bg-gray-800 relative overflow-hidden">
          <motion.div
            className="container px-4 md:px-6 relative z-10"
            style={{ opacity, scale }}
          >
            <motion.div
              className="flex flex-col items-center space-y-4 text-center"
              initial="hidden"
              animate="visible"
              variants={stagger}
            >
              <motion.h1
                className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl/none text-primary-800 dark:text-primary-100"
                variants={fadeInUp}
              >
                BabelTalk: Where Conversations{" "}
                <br className="hidden sm:inline" />
                Become Productivity
              </motion.h1>
              <motion.p
                className="mx-auto max-w-[700px] text-gray-600 dark:text-gray-300 md:text-xl"
                variants={fadeInUp}
              >
                Elevate your meetings with AI-powered transcription,
                translation, and summaries. Just talk, and let BabelTalk handle
                the rest.
              </motion.p>
              <motion.div
                className="w-full max-w-sm space-y-4"
                variants={fadeInUp}
              >
                <motion.div whileHover="hover" variants={scaleOnHover}>
                  <Button
                    size="lg"
                    className="w-full bg-primary-600 hover:bg-primary-700 text-white dark:bg-primary-500 dark:hover:bg-primary-600"
                  >
                    Create New Meeting
                  </Button>
                </motion.div>
                <div className="flex space-x-2">
                  <Input className="flex-1" placeholder="Enter meeting code" />
                  <motion.div whileHover="hover" variants={scaleOnHover}>
                    <Button
                      type="submit"
                      className="bg-orange-500 hover:bg-orange-600 text-white dark:bg-orange-600 dark:hover:bg-orange-700"
                    >
                      Join
                    </Button>
                  </motion.div>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
          <motion.div
            className="absolute top-1/2 left-4 transform -translate-y-1/2"
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5, duration: 0.5 }}
          >
            <Users className="h-16 w-16 text-primary-500 dark:text-primary-400 opacity-50" />
          </motion.div>
          <motion.div
            className="absolute top-1/4 right-4 transform -translate-y-1/2"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.7, duration: 0.5 }}
          >
            <Globe className="h-20 w-20 text-primary-400 dark:text-primary-300 opacity-50" />
          </motion.div>
          <motion.div
            className="absolute bottom-1/4 left-1/4 transform -translate-x-1/2"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.5 }}
          >
            <Zap className="h-12 w-12 text-primary-300 dark:text-primary-200 opacity-50" />
          </motion.div>
        </section>
        <motion.section
          id="features"
          className="w-full py-12 md:py-24 lg:py-32 bg-white dark:bg-gray-900"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: false, amount: 0.3 }}
          variants={stagger}
        >
          <div className="container px-4 md:px-6">
            <motion.h2
              className="text-3xl font-bold tracking-tighter sm:text-5xl text-center mb-12 text-primary-800 dark:text-primary-100"
              variants={fadeInUp}
            >
              Key Features
            </motion.h2>
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
                  variants={fadeInUp}
                  whileHover="hover"
                >
                  <motion.div
                    className="rounded-full p-3 bg-primary-100 dark:bg-primary-800"
                    variants={scaleOnHover}
                  >
                    <feature.icon className="h-8 w-8 text-primary-600 dark:text-primary-400" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-primary-800 dark:text-primary-100">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {feature.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>
        <motion.section
          id="how-it-works"
          className="w-full py-12 md:py-24 lg:py-32 bg-primary-50 dark:bg-gray-800"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={stagger}
        >
          <div className="container px-4 md:px-6">
            <motion.h2
              className="text-3xl font-bold tracking-tighter sm:text-5xl text-center mb-12 text-primary-800 dark:text-primary-100"
              variants={fadeInUp}
            >
              How It Works
            </motion.h2>
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
                    "Focus on your conversation, BabelTalk handles the rest",
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
                  variants={fadeInUp}
                >
                  <motion.div
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-600 dark:bg-primary-500 text-white"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    {item.step}
                  </motion.div>
                  <h3 className="text-xl font-bold text-primary-800 dark:text-primary-100">
                    {item.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {item.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>
        <motion.section
          id="benefits"
          className="w-full py-12 md:py-24 lg:py-32 bg-white dark:bg-gray-900"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={stagger}
        >
          <div className="container px-4 md:px-6">
            <motion.h2
              className="text-3xl font-bold tracking-tighter sm:text-5xl text-center mb-12 text-primary-800 dark:text-primary-100"
              variants={fadeInUp}
            >
              Benefits for Your Team
            </motion.h2>
            <div className="grid gap-8 sm:grid-cols-2">
              {[
                {
                  icon: Rocket,
                  title: "Increased Productivity",
                  description:
                    "With AI-powered transcription and summaries, your team can focus on discussions rather than note-taking.",
                },
                {
                  icon: Puzzle,
                  title: "Improved Collaboration",
                  description:
                    "Persistent chat and easy screen sharing make it simple for team members to stay connected and share ideas.",
                },
                {
                  icon: Languages,
                  title: "Better Accessibility",
                  description:
                    "Real-time translations and captions ensure that language barriers don't hinder communication.",
                },
                {
                  icon: FileText,
                  title: "Effortless Documentation",
                  description:
                    "Automatically generated transcripts and summaries make it easy to review and share meeting outcomes.",
                },
              ].map((benefit, index) => (
                <motion.div
                  key={index}
                  className="flex flex-col space-y-3 p-6 border border-primary-200 dark:border-primary-800 rounded-lg"
                  variants={fadeInUp}
                  whileHover="hover"
                >
                  <motion.div
                    className="flex items-center space-x-3"
                    variants={scaleOnHover}
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-800">
                      <benefit.icon className="h-5 w-5 text-primary-600 dark:text-primary-300" />
                    </div>
                    <h3 className="text-xl font-bold text-primary-800 dark:text-primary-100">
                      {benefit.title}
                    </h3>
                  </motion.div>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {benefit.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>
        <motion.section
          className="w-full py-12 md:py-24 lg:py-32 bg-primary-100 dark:bg-gray-800"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={stagger}
        >
          <div className="container px-4 md:px-6">
            <motion.div
              className="flex flex-col items-center space-y-4 text-center"
              variants={fadeInUp}
            >
              <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl text-primary-800 dark:text-primary-100">
                Ready to Transform Your Meetings?
              </h2>
              <p className="mx-auto max-w-[600px] text-gray-600 dark:text-gray-300 md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                Join thousands of teams already using BabelTalk to boost their
                productivity and collaboration.
              </p>
              <div className="w-full max-w-sm space-y-2">
                <form className="flex space-x-2">
                  <Input
                    className="max-w-lg flex-1"
                    placeholder="Enter your email"
                    type="email"
                  />
                  <motion.div whileHover="hover" variants={scaleOnHover}>
                    <Button
                      type="submit"
                      className="bg-primary-600 hover:bg-primary-700 text-white dark:bg-primary-500 dark:hover:bg-primary-600"
                    >
                      Get Started
                    </Button>
                  </motion.div>
                </form>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Start your free trial. No credit card required.
                </p>
              </div>
            </motion.div>
          </div>
        </motion.section>
      </main>
      <motion.footer
        className="flex flex-col gap-2 sm:flex-row py-6 w-full shrink-0 items-center px-4 md:px-6 border-t border-gray-200 dark:border-gray-800"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <p className="text-xs text-gray-500 dark:text-gray-400">
          © 2024 BabelTalk. All rights reserved.
        </p>
        <nav className="sm:ml-auto flex gap-4 sm:gap-6">
          <Link
            className="text-xs hover:underline underline-offset-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            href="#"
          >
            Terms of Service
          </Link>
          <Link
            className="text-xs hover:underline underline-offset-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            href="#"
          >
            Privacy
          </Link>
        </nav>
      </motion.footer>
    </div>
  );
}
