"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import io, { Socket } from "socket.io-client";
import Peer from "simple-peer";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  PhoneOff,
  Copy,
  ScreenShare,
  Settings,
  Maximize2,
  Layout,
  MoreVertical,
  Minimize2,
  MonitorUp,
  RotateCw,
  Users,
  MessageCircle,
  Paperclip,
  SendIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import Chat from "./Chat";
import {
  Sidebar,
  SidebarContent,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQuasiPeer } from "@/hooks/useQuasiPeer";
import { TranscriptionPanel } from "@/components/meeting/TranscriptionPanel";
import { TranslationPanel } from "@/components/meeting/TranslationPanel";
import type { TranscriptionResult, TranslationResult } from "@/types/quasiPeer";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useAudioProcessing } from "@/hooks/useAudioProcessing";
import { useWebSocketConnection } from "@/hooks/useWebSocketConnection";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

interface PeerData {
  peer: Peer.Instance;
  userName: string;
  isMuted: boolean;
  isCameraOff: boolean;
}

interface SettingsState {
  video: {
    sendResolution: string;
    receiveResolution: string;
    frameRate: number;
  };
  audio: {
    noiseSuppression: boolean;
    echoCancellation: boolean;
  };
  general: {
    enterFullScreenOnJoin: boolean;
    muteOnJoin: boolean;
  };
}

type LayoutType = "speaker" | "grid" | "sidebar";

// Add this type for sidebar content
type SidebarContent = "chat" | "participants" | "ai" | null;

// Add this interface near the top of the file with other interfaces
interface User {
  id: string;
  userName: string;
  isMuted: boolean;
  isCameraOff: boolean;
  isHost?: boolean;
}

function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-700">
      <div className="w-24 h-24 rounded-full bg-primary flex items-center justify-center text-3xl font-semibold text-primary-foreground">
        {initials}
      </div>
    </div>
  );
}

// Add type for audio cleanup
type AudioCleanupFn = () => void;

// Add ref types
interface TranscriptionPanelRef {
  addTranscription: (result: TranscriptionResult) => void;
  getTranscripts: () => TranscriptionResult[];
}

interface TranslationPanelRef {
  addTranslation: (result: TranslationResult) => void;
}

// Add types for new features
interface SentimentAnalysis {
  score: number; // -1 to 1
  label: "negative" | "neutral" | "positive";
  timestamp: number;
}

interface SpeakerSegment {
  speakerId: string;
  speakerName: string;
  text: string;
  startTime: number;
  endTime: number;
  sentiment?: SentimentAnalysis;
}

interface MeetingAnalytics {
  duration: number;
  participantCount: number;
  speakingTime: { [participantId: string]: number };
  sentimentTrend: SentimentAnalysis[];
  participantEngagement: {
    [participantId: string]: {
      speakingTime: number;
      messageCount: number;
      reactionCount: number;
      attentiveness: number; // 0 to 1
    };
  };
  topics: {
    name: string;
    duration: number;
    sentiment: SentimentAnalysis;
    participants: string[];
  }[];
}

export default function Meeting({
  params,
}: {
  params: { meetingCode: string };
}) {
  const { user, isLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [peers, setPeers] = useState<PeerData[]>([]);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [showNewMeetingModal, setShowNewMeetingModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [currentLayout, setCurrentLayout] = useState<LayoutType>("speaker");
  const [settings, setSettings] = useState<SettingsState>({
    video: {
      sendResolution: "720p",
      receiveResolution: "720p",
      frameRate: 30,
    },
    audio: {
      noiseSuppression: true,
      echoCancellation: true,
    },
    general: {
      enterFullScreenOnJoin: false,
      muteOnJoin: false,
    },
  });

  // Add state for meeting summary and analytics
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [meetingSummary, setMeetingSummary] = useState<{
    topics: string[];
    keyPoints: string[];
    actionItems: string[];
  } | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [sentimentAnalysis, setSentimentAnalysis] = useState<
    SentimentAnalysis[]
  >([]);
  const [speakerSegments, setSpeakerSegments] = useState<SpeakerSegment[]>([]);
  const [meetingAnalytics, setMeetingAnalytics] =
    useState<MeetingAnalytics | null>(null);
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [meetingStartTime] = useState<number>(Date.now());

  // Add refs
  const transcriptionPanelRef = useRef<TranscriptionPanelRef>(null);
  const translationPanelRef = useRef<TranslationPanelRef>(null);
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const peersRef = useRef<
    { peerID: string; peer: Peer.Instance; userName: string }[]
  >([]);

  // Add mobile detection and permissions
  const [isMobile, setIsMobile] = useState(false);
  const [cameraPermission, setCameraPermission] =
    useState<PermissionState | null>(null);
  const [micPermission, setMicPermission] = useState<PermissionState | null>(
    null
  );
  const [sidebarContent, setSidebarContent] = useState<SidebarContent>(null);
  const [isHost, setIsHost] = useState(false);

  // Use mediaDevices hook with renamed functions to avoid conflicts
  const {
    stream,
    screenStream,
    mediaState: { isMicOn, isCameraOn, isScreenSharing },
    mediaError,
    initializeMedia,
    toggleMic,
    toggleCamera,
    switchCamera: handleSwitchCamera,
    toggleScreenShare: handleToggleScreenShare,
    stopScreenSharing: handleStopScreenShare,
    cleanupMediaStream,
    setMediaError,
  } = useMediaDevices(settings);

  const [availableResolutions, setAvailableResolutions] = useState<string[]>(
    []
  );
  const socketRef = useRef<Socket | null>(null);
  const MAX_RECONNECTION_ATTEMPTS = 3;

  // Handler functions
  const handleTranscriptionResult = useCallback(
    (result: TranscriptionResult) => {
      transcriptionPanelRef.current?.addTranscription(result);
    },
    []
  );

  const handleSpeakerIdentified = useCallback(
    (speakerId: string, speakerName: string) => {
      setCurrentSpeaker(speakerName);
    },
    []
  );

  const handleSentimentAnalyzed = useCallback(
    (sentiment: { score: number; label: string }) => {
      setSentimentAnalysis((prev: SentimentAnalysis[]) => [
        ...prev,
        {
          score: sentiment.score,
          label: sentiment.label as "negative" | "neutral" | "positive",
          timestamp: Date.now(),
        },
      ]);
    },
    []
  );

  const handleParticipantJoined = useCallback((participant: any) => {
    console.log("New participant joined:", participant);
  }, []);

  const handleParticipantLeft = useCallback((participantId: string) => {
    console.log("Participant left:", participantId);
  }, []);

  const handlePeerError = useCallback(
    (error: Error) => {
      console.error("Peer connection error:", error);
      setMediaError("Peer connection error. Please try reconnecting.");
    },
    [setMediaError]
  );

  const handleConnectionError = useCallback(
    (error: Error) => {
      console.error("Connection error:", error);
      setMediaError("Connection error. Please try reconnecting.");
    },
    [setMediaError]
  );

  const { isProcessing, startProcessing, stopProcessing } = useAudioProcessing({
    onTranscriptionResult: handleTranscriptionResult,
    onSpeakerIdentified: handleSpeakerIdentified,
    meetingId: params.meetingCode,
    userName: user?.name || "Anonymous",
    preferredLanguage: "en",
  });

  const {
    socket,
    isConnected,
    isReconnecting,
    reconnectionAttempts,
    connect: connectSocket,
    disconnect: disconnectSocket,
  } = useWebSocketConnection({
    url: process.env.NEXT_PUBLIC_QUASI_PEER_URL || "",
    roomId: params.meetingCode,
    userName: user?.name || "Anonymous",
    onParticipantJoined: handleParticipantJoined,
    onParticipantLeft: handleParticipantLeft,
    onPeerError: handlePeerError,
    onConnectionError: handleConnectionError,
  });

  // Add missing functions
  const getMediaConstraints = () => ({
    video: {
      width:
        settings.video.sendResolution === "1080p"
          ? 1920
          : settings.video.sendResolution === "720p"
          ? 1280
          : 854,
      height:
        settings.video.sendResolution === "1080p"
          ? 1080
          : settings.video.sendResolution === "720p"
          ? 720
          : 480,
      frameRate: settings.video.frameRate,
    },
    audio: {
      noiseSuppression: settings.audio.noiseSuppression,
      echoCancellation: settings.audio.echoCancellation,
    },
  });

  const requestTranslation = async (text: string, targetLanguage: string) => {
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, targetLanguage }),
      });
      const result = await response.json();
      return result;
    } catch (error) {
      console.error("Translation error:", error);
      return null;
    }
  };

  // Update toggleMicState function
  const toggleMicState = () => {
    if (stream) {
      stream.getAudioTracks().forEach((track) => (track.enabled = !isMicOn));
      toggleMic();
    }
  };

  // Update toggleCameraState function
  const toggleCameraState = () => {
    if (stream) {
      stream.getVideoTracks().forEach((track) => (track.enabled = !isCameraOn));
      toggleCamera();
    }
  };

  // Update leaveMeeting function
  const leaveMeeting = () => {
    socket?.disconnect();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    router.push("/");
  };

  // Update createPeer function
  function createPeer(
    userToSignal: string,
    callerID: string,
    stream: MediaStream
  ) {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" },
        ],
      },
    });

    peer.on("signal", (signal) => {
      socket?.emit("sending signal", {
        userToSignal,
        callerID,
        signal,
        userName: user?.name || "Anonymous",
      });
    });

    return peer;
  }

  // Update addPeer function
  function addPeer(
    incomingSignal: Peer.SignalData,
    callerID: string,
    stream: MediaStream
  ) {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" },
        ],
      },
    });

    peer.on("signal", (signal) => {
      socket?.emit("returning signal", { signal, callerID });
    });

    peer.signal(incomingSignal);

    return peer;
  }

  // Add function to get video layout class
  const getVideoLayout = useCallback(() => {
    if (peers.length === 0) return "w-full h-full";
    if (currentLayout === "grid") {
      return cn(
        "w-full h-full grid gap-2",
        peers.length === 1 && "grid-cols-1",
        peers.length === 2 && "grid-cols-2",
        peers.length > 2 && "grid-cols-3 grid-rows-2"
      );
    }
    return "w-1/4 h-1/4 absolute bottom-4 right-4";
  }, [peers.length, currentLayout]);

  // Add function to handle host actions
  const handleHostAction = useCallback(
    (action: string, userId: string) => {
      if (!isHost || !socket) return;
      socket.emit("host-action", { action, userId });
    },
    [isHost, socket]
  );

  // Add function to handle transcription toggle
  const handleToggleTranscription = useCallback(async () => {
    if (!stream) return;

    if (!isTranscribing) {
      await startProcessing(stream);
      setIsTranscribing(true);
    } else {
      stopProcessing();
      setIsTranscribing(false);
    }
  }, [stream, isTranscribing, startProcessing, stopProcessing]);

  // Add function to retry media access
  const retryMediaAccess = useCallback(async () => {
    setMediaError(null);
    const success = await initializeMedia();
    if (success) {
      setMediaError(null);
    }
  }, [initializeMedia, setMediaError]);

  useEffect(() => {
    if (!user && !isLoading) {
      router.push("/");
    }
  }, [user, isLoading, router]);

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const isMobileDevice =
        /mobile|android|iphone|ipad|ipod|windows phone/i.test(userAgent);
      setIsMobile(isMobileDevice);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Update the permission check function
  const checkAndRequestPermissions = async () => {
    try {
      // For mobile browsers, we need to explicitly request permissions one by one
      try {
        // Try camera first
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        videoStream.getTracks().forEach((track) => track.stop());
        setCameraPermission("granted");
      } catch (error) {
        console.error("Camera permission error:", error);
        if (error instanceof DOMException) {
          if (error.name === "NotAllowedError") {
            setCameraPermission("denied");
            setMediaError(
              "Camera access denied. Please grant camera permission and reload."
            );
          } else if (error.name === "NotFoundError") {
            setCameraPermission("denied");
            setMediaError(
              "No camera found. Please check your device settings."
            );
          }
        }
        return false;
      }

      // Then try microphone
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        audioStream.getTracks().forEach((track) => track.stop());
        setMicPermission("granted");
      } catch (error) {
        console.error("Microphone permission error:", error);
        if (error instanceof DOMException) {
          if (error.name === "NotAllowedError") {
            setMicPermission("denied");
            setMediaError(
              "Microphone access denied. Please grant microphone permission and reload."
            );
          } else if (error.name === "NotFoundError") {
            setMicPermission("denied");
            setMediaError(
              "No microphone found. Please check your device settings."
            );
          }
        }
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error checking permissions:", error);
      setMediaError(
        "An error occurred while checking device permissions. Please reload and try again."
      );
      return false;
    }
  };

  // Update the main useEffect to handle permissions better
  useEffect(() => {
    if (user) {
      const initializeConnection = async () => {
        try {
          // Initialize media devices
          const mediaStream = await initializeMedia();
          if (!mediaStream) {
            setMediaError("Failed to initialize media devices");
            return;
          }

          // Update video element
          if (userVideoRef.current) {
            userVideoRef.current.srcObject = mediaStream;
            await userVideoRef.current.play().catch(console.error);
          }

          // Connect to socket
          await connectSocket();

          // Join room
          if (socket) {
            socket.emit("join room", {
              roomID: params.meetingCode,
              userName: user.name || "Anonymous",
              isMuted: !isMicOn,
              isCameraOff: !isCameraOn,
            });
          }

          return () => {
            // Cleanup
            cleanupMediaStream(mediaStream);
            if (screenStream) {
              cleanupMediaStream(screenStream);
            }
            disconnectSocket();
          };
        } catch (error) {
          console.error("Error initializing connection:", error);
          setMediaError("Failed to initialize connection");
        }
      };

      if (navigator.mediaDevices) {
        initializeConnection();
      } else {
        setMediaError(
          "Your browser doesn't support media devices. Please try using a different browser."
        );
      }
    }
  }, [
    user,
    params.meetingCode,
    isMicOn,
    isCameraOn,
    initializeMedia,
    connectSocket,
    disconnectSocket,
    socket,
    cleanupMediaStream,
    screenStream,
    setMediaError,
  ]);

  useEffect(() => {
    if (searchParams && searchParams.get("new") === "true") {
      setShowNewMeetingModal(true);
    }
  }, [searchParams]);

  // Update switchCamera function
  const switchCamera = async () => {
    if (!stream) return;

    try {
      // Stop and cleanup old video tracks
      const oldVideoTracks = stream.getVideoTracks();
      oldVideoTracks.forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });

      // Get new stream with different camera
      const newStream = await navigator.mediaDevices.getUserMedia({
        ...getMediaConstraints(),
        video: {
          ...(getMediaConstraints().video as MediaTrackConstraints),
          facingMode: isBackCamera ? "user" : "environment",
        },
      });

      // Keep the existing audio track
      const audioTrack = stream.getAudioTracks()[0];
      const newVideoTrack = newStream.getVideoTracks()[0];

      // Stop tracks from the temporary new stream
      newStream.getAudioTracks().forEach((track) => {
        track.stop();
        newStream.removeTrack(track);
      });

      // Add the new video track to the existing stream
      stream.addTrack(newVideoTrack);

      // Update local video
      if (userVideoRef.current) {
        userVideoRef.current.srcObject = stream;
      }

      setIsBackCamera(!isBackCamera);

      // Update QuasiPeer connection
      const videoProducer = producersRef.current?.get("video");
      if (videoProducer) {
        await videoProducer.replaceTrack({ track: newVideoTrack });
      }
    } catch (error) {
      console.error("Error switching camera:", error);
      setMediaError("Failed to switch camera. Please try again.");
    }
  };

  // Add missing state variables
  const [isBackCamera, setIsBackCamera] = useState(false);
  const [originalVideoTrack, setOriginalVideoTrack] =
    useState<MediaStreamTrack | null>(null);
  const producersRef = useRef<Map<string, any>>(new Map());

  // Add missing audio state variables
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [audioProcessor, setAudioProcessor] =
    useState<ScriptProcessorNode | null>(null);

  // Add copyMeetingLink function
  const copyMeetingLink = useCallback(async () => {
    const meetingUrl = `${window.location.origin}/meeting/${params.meetingCode}`;
    try {
      await navigator.clipboard.writeText(meetingUrl);
      toast.success("Meeting link copied to clipboard");
    } catch (error) {
      console.error("Failed to copy meeting link:", error);
      toast.error("Failed to copy meeting link");
    }
  }, [params.meetingCode]);

  // Add function to detect supported resolutions
  const detectSupportedResolutions = async () => {
    const resolutions = [
      { width: 1920, height: 1080, label: "1080p" },
      { width: 1280, height: 720, label: "720p" },
      { width: 854, height: 480, label: "480p" },
      { width: 640, height: 360, label: "360p" },
    ] as const;

    const supported: string[] = [];
    for (const res of resolutions) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: res.width },
            height: { ideal: res.height },
          },
        });
        supported.push(res.label);
        stream.getTracks().forEach((track) => track.stop());
      } catch (e) {
        console.log(`Resolution ${res.label} not supported`);
      }
    }

    // Always include at least 360p if nothing else is supported
    if (supported.length === 0) {
      supported.push("360p");
    }

    setAvailableResolutions(supported);

    // Set initial resolution to the highest available
    if (supported.length > 0) {
      setSettings((prev) => ({
        ...prev,
        video: {
          ...prev.video,
          sendResolution: supported[0],
        },
      }));
    }
  };

  // Call detection on component mount
  useEffect(() => {
    detectSupportedResolutions();
  }, []);

  // Apply video settings
  const applyVideoSettings = async () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const constraints = {
          width:
            settings.video.sendResolution === "1080p"
              ? 1920
              : settings.video.sendResolution === "720p"
              ? 1280
              : 854,
          height:
            settings.video.sendResolution === "1080p"
              ? 1080
              : settings.video.sendResolution === "720p"
              ? 720
              : 480,
          frameRate: settings.video.frameRate,
        };

        try {
          await videoTrack.applyConstraints(constraints);
        } catch (error) {
          console.error("Error applying video constraints:", error);
          setMediaError(
            "Failed to apply video settings. Your device may not support these settings."
          );
        }
      }
    }
  };

  // Apply audio settings
  const applyAudioSettings = async () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const constraints = {
          noiseSuppression: settings.audio.noiseSuppression,
          echoCancellation: settings.audio.echoCancellation,
        };

        try {
          await audioTrack.applyConstraints(constraints);
        } catch (error) {
          console.error("Error applying audio constraints:", error);
          setMediaError(
            "Failed to apply audio settings. Your device may not support these settings."
          );
        }
      }
    }
  };

  // Watch for settings changes
  useEffect(() => {
    applyVideoSettings();
  }, [settings.video]);

  useEffect(() => {
    applyAudioSettings();
  }, [settings.audio]);

  // Apply initial settings when joining
  useEffect(() => {
    if (settings.general.enterFullScreenOnJoin && containerRef.current) {
      containerRef.current.requestFullscreen().catch(console.error);
    }
    if (settings.general.muteOnJoin) {
      toggleMic();
      if (stream) {
        stream.getAudioTracks().forEach((track) => (track.enabled = false));
      }
    }
  }, []);

  // Add device change handling
  useEffect(() => {
    const handleDeviceChange = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasVideo = devices.some((device) => device.kind === "videoinput");
        const hasAudio = devices.some((device) => device.kind === "audioinput");

        if (!hasVideo && isCameraOn) {
          toggleCamera();
          setMediaError("Video device disconnected");
        }
        if (!hasAudio && isMicOn) {
          toggleMic();
          setMediaError("Audio device disconnected");
        }
      } catch (error) {
        console.error("Error handling device change:", error);
      }
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange
      );
    };
  }, [isMicOn, isCameraOn]);

  // Update cleanup in main useEffect
  useEffect(() => {
    if (user) {
      const initializeConnection = async () => {
        try {
          // Initialize media devices
          const mediaStream = await initializeMedia();
          if (!mediaStream) {
            setMediaError("Failed to initialize media devices");
            return;
          }

          // Update video element
          if (userVideoRef.current) {
            userVideoRef.current.srcObject = mediaStream;
            await userVideoRef.current.play().catch(console.error);
          }

          // Connect to socket
          await connectSocket();

          // Join room
          if (socket) {
            socket.emit("join room", {
              roomID: params.meetingCode,
              userName: user.name || "Anonymous",
              isMuted: !isMicOn,
              isCameraOff: !isCameraOn,
            });
          }

          return () => {
            // Cleanup
            cleanupMediaStream(mediaStream);
            if (screenStream) {
              cleanupMediaStream(screenStream);
            }
            disconnectSocket();
          };
        } catch (error) {
          console.error("Error initializing connection:", error);
          setMediaError("Failed to initialize connection");
        }
      };

      if (navigator.mediaDevices) {
        initializeConnection();
      } else {
        setMediaError(
          "Your browser doesn't support media devices. Please try using a different browser."
        );
      }
    }
  }, [
    user,
    params.meetingCode,
    isMicOn,
    isCameraOn,
    initializeMedia,
    connectSocket,
    disconnectSocket,
    socket,
    cleanupMediaStream,
    screenStream,
    setMediaError,
  ]);

  // Add picture-in-picture and fullscreen functions
  const togglePictureInPicture = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPictureInPicture(false);
      } else if (userVideoRef.current) {
        await userVideoRef.current.requestPictureInPicture();
        setIsPictureInPicture(true);
      }
    } catch (error) {
      console.error("Picture-in-Picture error:", error);
      setMediaError(
        "Picture-in-Picture mode is not supported in your browser."
      );
    }
  };

  const toggleFullScreen = async () => {
    try {
      if (!document.fullscreenElement && containerRef.current) {
        await containerRef.current.requestFullscreen();
        setIsFullScreen(true);
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullScreen(false);
      }
    } catch (error) {
      console.error("Fullscreen error:", error);
      setMediaError("Fullscreen mode is not supported in your browser.");
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <TooltipProvider>
      <Toaster />
      <div className="flex h-screen">
        {/* Main video area - 75% when sidebar is open */}
        <div
          className={cn(
            "flex flex-col transition-[width] duration-300 ease-in-out",
            sidebarContent ? "w-3/4" : "w-full"
          )}
          ref={containerRef}
        >
          <div className="flex-1 p-2 sm:p-4 overflow-hidden">
            <div className="relative w-full h-full">
              {/* Display other participants' videos */}
              <AnimatePresence>
                {peers.map(
                  ({ peer, userName, isMuted, isCameraOff }, index) => (
                    <motion.div
                      key={`peer-${index}`}
                      className="absolute inset-0"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.3 }}
                    >
                      <Card className="w-full h-full overflow-hidden rounded-lg relative">
                        <Video
                          peer={peer}
                          isCameraOff={isCameraOff}
                          userName={userName}
                        />
                        <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded flex items-center space-x-2">
                          <span>{userName}</span>
                          {isMuted && <MicOff className="h-4 w-4" />}
                        </div>
                      </Card>
                    </motion.div>
                  )
                )}
              </AnimatePresence>

              {/* Display user's own video */}
              <motion.div
                className={cn("rounded-lg overflow-hidden", getVideoLayout())}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.3 }}
              >
                <Card className="w-full h-full overflow-hidden rounded-lg relative">
                  {!isCameraOn ? (
                    <UserAvatar name={user.name || "You"} />
                  ) : (
                    <video
                      ref={userVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover mirror"
                    />
                  )}
                  <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded flex items-center space-x-2">
                    <span>{user.name || "You"}</span>
                    {!isMicOn && <MicOff className="h-4 w-4" />}
                  </div>
                </Card>
              </motion.div>
            </div>
          </div>
          <div className="p-2 sm:p-4 bg-white dark:bg-gray-800 shadow-lg">
            <div className="flex flex-wrap justify-center sm:justify-between items-center gap-2 max-w-4xl mx-auto">
              <div className="flex flex-wrap justify-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={toggleMicState}
                    >
                      {isMicOn ? (
                        <Mic className="h-4 w-4" />
                      ) : (
                        <MicOff className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isMicOn ? "Mute" : "Unmute"}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={toggleCameraState}
                    >
                      {isCameraOn ? (
                        <VideoIcon className="h-4 w-4" />
                      ) : (
                        <VideoOff className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isCameraOn ? "Stop Video" : "Start Video"}
                  </TooltipContent>
                </Tooltip>

                {isMobile && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={switchCamera}
                      >
                        <RotateCw className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Switch Camera</TooltipContent>
                  </Tooltip>
                )}

                {!isMobile && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleToggleScreenShare}
                      >
                        <ScreenShare
                          className={`h-4 w-4 ${
                            isScreenSharing ? "text-primary" : ""
                          }`}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isScreenSharing ? "Stop Sharing" : "Share Screen"}
                    </TooltipContent>
                  </Tooltip>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setSidebarContent(
                          sidebarContent === "participants"
                            ? null
                            : "participants"
                        )
                      }
                    >
                      <Users className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Participants</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setSidebarContent(
                          sidebarContent === "chat" ? null : "chat"
                        )
                      }
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Chat</TooltipContent>
                </Tooltip>
              </div>

              <Button
                variant="destructive"
                onClick={leaveMeeting}
                className="order-last sm:order-none"
              >
                <PhoneOff className="mr-2 h-4 w-4" /> Leave
              </Button>

              <div className="flex flex-wrap justify-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={copyMeetingLink}
                      className="text-sm"
                    >
                      <Copy className="mr-2 h-4 w-4" /> Copy Link
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy Meeting Link</TooltipContent>
                </Tooltip>

                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>More Options</TooltipContent>
                  </Tooltip>

                  <DropdownMenuContent align="end" className="z-[9999]">
                    <DropdownMenuItem
                      onClick={() => setShowSettingsModal(true)}
                    >
                      <Settings className="mr-2 h-4 w-4" /> Settings
                    </DropdownMenuItem>
                    {!isMobile && (
                      <DropdownMenuItem onClick={togglePictureInPicture}>
                        <Minimize2 className="mr-2 h-4 w-4" /> Picture in
                        Picture
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={toggleFullScreen}>
                      {isFullScreen ? (
                        <Minimize2 className="mr-2 h-4 w-4" />
                      ) : (
                        <Maximize2 className="mr-2 h-4 w-4" />
                      )}
                      {isFullScreen ? "Exit Full Screen" : "Full Screen"}
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Layout className="mr-2 h-4 w-4" /> Layout
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="z-[9999]">
                        <DropdownMenuRadioGroup
                          value={currentLayout}
                          onValueChange={(value) =>
                            setCurrentLayout(value as LayoutType)
                          }
                        >
                          <DropdownMenuRadioItem value="speaker">
                            Speaker View
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="grid">
                            Grid View
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar - 25% */}
        {sidebarContent && (
          <div className="w-1/4 border-l border-border h-screen bg-background">
            {sidebarContent === "chat" && (
              <div className="flex flex-col h-full">
                <div className="p-4 border-b">
                  <h2 className="text-lg font-semibold">Chat</h2>
                </div>
                <div className="flex-1 overflow-hidden">
                  <Chat
                    roomID={params.meetingCode}
                    userName={user.name || "You"}
                    isHost={isHost}
                    onToggleUserAudio={(userId) =>
                      handleHostAction("mute_user", userId)
                    }
                    onToggleUserVideo={(userId) =>
                      handleHostAction("disable_video", userId)
                    }
                  />
                </div>
              </div>
            )}
            {sidebarContent === "ai" && (
              <div className="flex flex-col h-full">
                <div className="p-4 border-b">
                  <h2 className="text-lg font-semibold">Transcription</h2>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <TranscriptionPanel
                    isTranscribing={isTranscribing}
                    onToggleTranscription={handleToggleTranscription}
                    onRequestTranslation={requestTranslation}
                    supportedLanguages={["en", "es", "fr", "de", "hi", "mr"]}
                  />
                </div>
              </div>
            )}
            {sidebarContent === "participants" && (
              <div className="flex flex-col h-full">
                <div className="p-4 border-b">
                  <h2 className="text-lg font-semibold">Participants</h2>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <ul className="p-4 space-y-2">
                    <li className="flex items-center justify-between">
                      <span>{user.name || "You"} (You)</span>
                      <div className="flex items-center space-x-2">
                        {isCameraOn ? (
                          <VideoIcon className="h-4 w-4 text-green-500" />
                        ) : (
                          <VideoOff className="h-4 w-4 text-red-500" />
                        )}
                        {isMicOn ? (
                          <Mic className="h-4 w-4 text-green-500" />
                        ) : (
                          <MicOff className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                    </li>
                    {peers.map(
                      ({ peer, userName, isMuted, isCameraOff }, index) => (
                        <li
                          key={index}
                          className="flex items-center justify-between p-2 hover:bg-muted/50 rounded-md"
                        >
                          <span className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback>
                                {userName[0].toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span>{userName}</span>
                          </span>
                          <div className="flex items-center gap-2">
                            {isHost && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() =>
                                    handleHostAction(
                                      "mute_user",
                                      peersRef.current[index].peerID
                                    )
                                  }
                                  title={
                                    isMuted
                                      ? "Unmute participant"
                                      : "Mute participant"
                                  }
                                >
                                  {isMuted ? (
                                    <MicOff className="h-4 w-4 text-red-500" />
                                  ) : (
                                    <Mic className="h-4 w-4 text-green-500" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() =>
                                    handleHostAction(
                                      "disable_video",
                                      peersRef.current[index].peerID
                                    )
                                  }
                                  title={
                                    isCameraOff
                                      ? "Enable camera"
                                      : "Disable camera"
                                  }
                                >
                                  {isCameraOff ? (
                                    <VideoOff className="h-4 w-4 text-red-500" />
                                  ) : (
                                    <VideoIcon className="h-4 w-4 text-green-500" />
                                  )}
                                </Button>
                              </>
                            )}
                            {!isHost && (
                              <>
                                {isCameraOff ? (
                                  <VideoOff className="h-4 w-4 text-red-500" />
                                ) : (
                                  <VideoIcon className="h-4 w-4 text-green-500" />
                                )}
                                {isMuted ? (
                                  <MicOff className="h-4 w-4 text-red-500" />
                                ) : (
                                  <Mic className="h-4 w-4 text-green-500" />
                                )}
                              </>
                            )}
                          </div>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {showCopyToast && (
          <motion.div
            className="fixed bottom-4 right-4 bg-green-500 text-white p-2 rounded"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
          >
            Meeting link copied to clipboard!
          </motion.div>
        )}

        {mediaError && (
          <motion.div
            className="fixed bottom-4 left-4 bg-red-500 text-white p-4 rounded-lg shadow-lg max-w-md"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <p className="font-semibold">Device Access Error:</p>
                <p className="text-sm">{mediaError}</p>
                {(cameraPermission === "denied" ||
                  micPermission === "denied") && (
                  <p className="text-sm mt-1">
                    Tip: Look for the camera/microphone icon in your
                    browser&apos;s address bar to manage permissions.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={retryMediaAccess}
                  className="bg-white text-red-500 hover:bg-red-100"
                >
                  Retry Access
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => window.location.reload()}
                  className="bg-white text-red-500 hover:bg-red-100"
                >
                  Reload Page
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        <Dialog
          open={showNewMeetingModal}
          onOpenChange={setShowNewMeetingModal}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Meeting Created</DialogTitle>
              <DialogDescription>
                Your meeting has been created successfully. Share this link with
                others to invite them to the meeting.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center space-x-2">
              <Input
                value={`${window.location.origin}/pre-join/${params.meetingCode}`}
                readOnly
              />
              <Button onClick={copyMeetingLink}>
                <Copy className="mr-2 h-4 w-4" /> Copy
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Settings Modal */}
        <Dialog open={showSettingsModal} onOpenChange={setShowSettingsModal}>
          <DialogContent className="sm:max-w-[425px] w-[95vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription>
                Adjust your meeting settings
              </DialogDescription>
            </DialogHeader>
            <Tabs defaultValue="video" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="video">Video</TabsTrigger>
                <TabsTrigger value="audio">Audio</TabsTrigger>
                <TabsTrigger value="general">General</TabsTrigger>
              </TabsList>
              <TabsContent value="video" className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Send Resolution</Label>
                    <select
                      className="w-full p-2 rounded-md border"
                      value={settings.video.sendResolution}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          video: {
                            ...settings.video,
                            sendResolution: e.target.value,
                          },
                        })
                      }
                    >
                      {availableResolutions.map((resolution) => (
                        <option key={resolution} value={resolution}>
                          {resolution}
                        </option>
                      ))}
                    </select>
                    <p className="text-sm text-gray-500">
                      These are the resolutions supported by your device
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Frame Rate</Label>
                    <Slider
                      value={[settings.video.frameRate]}
                      onValueChange={(value) =>
                        setSettings({
                          ...settings,
                          video: { ...settings.video, frameRate: value[0] },
                        })
                      }
                      max={60}
                      min={15}
                      step={5}
                    />
                    <div className="text-sm text-gray-500">
                      {settings.video.frameRate} FPS
                    </div>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="audio" className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="noise-suppression">Noise Suppression</Label>
                    <Switch
                      id="noise-suppression"
                      checked={settings.audio.noiseSuppression}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          audio: {
                            ...settings.audio,
                            noiseSuppression: checked,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="echo-cancellation">Echo Cancellation</Label>
                    <Switch
                      id="echo-cancellation"
                      checked={settings.audio.echoCancellation}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          audio: {
                            ...settings.audio,
                            echoCancellation: checked,
                          },
                        })
                      }
                    />
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="general" className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="full-screen-join">
                      Enter Full Screen on Join
                    </Label>
                    <Switch
                      id="full-screen-join"
                      checked={settings.general.enterFullScreenOnJoin}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          general: {
                            ...settings.general,
                            enterFullScreenOnJoin: checked,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="mute-on-join">Mute on Join</Label>
                    <Switch
                      id="mute-on-join"
                      checked={settings.general.muteOnJoin}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          general: { ...settings.general, muteOnJoin: checked },
                        })
                      }
                    />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        {/* Add Meeting Summary Modal */}
        <Dialog open={showSummaryModal} onOpenChange={setShowSummaryModal}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Meeting Summary</DialogTitle>
              <DialogDescription>
                Here&apos;s a summary of your meeting
              </DialogDescription>
            </DialogHeader>

            {meetingSummary ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Main Topics</h3>
                  <ul className="list-disc pl-4">
                    {meetingSummary.topics.map((topic, index) => (
                      <li key={index}>{topic}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Key Points</h3>
                  <ul className="list-disc pl-4">
                    {meetingSummary.keyPoints.map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Action Items</h3>
                  <ul className="list-disc pl-4">
                    {meetingSummary.actionItems.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="pt-4 flex justify-end space-x-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      const summary = {
                        ...meetingSummary,
                        meetingId: params.meetingCode,
                        date: new Date().toISOString(),
                      };

                      // Download summary as JSON
                      const blob = new Blob(
                        [JSON.stringify(summary, null, 2)],
                        {
                          type: "application/json",
                        }
                      );
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `meeting-summary-${params.meetingCode}.json`;
                      a.click();
                    }}
                  >
                    Download Summary
                  </Button>
                  <Button
                    onClick={() => {
                      setShowSummaryModal(false);
                      router.push("/");
                    }}
                  >
                    Close
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center p-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Add Reconnection Indicator */}
        {isReconnecting && (
          <div className="fixed top-4 right-4 bg-yellow-500 text-white px-4 py-2 rounded-md shadow-lg flex items-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            <span>
              Reconnecting... Attempt {reconnectionAttempts}/
              {MAX_RECONNECTION_ATTEMPTS}
            </span>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function Video({
  peer,
  isCameraOff,
  userName,
}: {
  peer: Peer.Instance;
  isCameraOff: boolean;
  userName: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isCameraOff) {
      if (ref.current) {
        ref.current.srcObject = null;
      }
      return;
    }

    peer.on("stream", (stream) => {
      if (ref.current) {
        ref.current.srcObject = stream;
      }
    });
  }, [peer, isCameraOff]);

  if (isCameraOff) {
    return <UserAvatar name={userName} />;
  }

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      className="w-full h-full object-cover"
    />
  );
}
