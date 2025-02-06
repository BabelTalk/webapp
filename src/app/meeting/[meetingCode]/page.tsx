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
type SidebarContent = "chat" | "participants" | null;

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

export default function Meeting({
  params,
}: {
  params: { meetingCode: string };
}) {
  const { user, isLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [peers, setPeers] = useState<PeerData[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [showNewMeetingModal, setShowNewMeetingModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [currentLayout, setCurrentLayout] = useState<LayoutType>("speaker");
  const [mediaError, setMediaError] = useState<string | null>(null);
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

  // Add state for available resolutions
  const [availableResolutions, setAvailableResolutions] = useState<string[]>(
    []
  );

  // Add mobile detection
  const [isMobile, setIsMobile] = useState(false);

  // Add separate permission states
  const [cameraPermission, setCameraPermission] =
    useState<PermissionState | null>(null);
  const [micPermission, setMicPermission] = useState<PermissionState | null>(
    null
  );

  const socketRef = useRef<Socket | null>(null);
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const peersRef = useRef<
    { peerID: string; peer: Peer.Instance; userName: string }[]
  >([]);

  const [showParticipantsDrawer, setShowParticipantsDrawer] = useState(false);
  const [showChatSidebar, setShowChatSidebar] = useState(false);

  const [sidebarContent, setSidebarContent] = useState<SidebarContent>(null);
  const [isHost, setIsHost] = useState(false);

  // Add camera switch function for mobile
  const [isBackCamera, setIsBackCamera] = useState(false);

  // Update the getMediaConstraints function
  const getMediaConstraints = useCallback(() => {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: settings.audio.echoCancellation,
        noiseSuppression: settings.audio.noiseSuppression,
      },
      video: isMobile
        ? {
            facingMode: isBackCamera ? "environment" : "user",
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
            frameRate: { max: 30 },
          }
        : {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { max: settings.video.frameRate },
          },
    };
    return constraints;
  }, [isMobile, isBackCamera, settings.audio, settings.video.frameRate]);

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

  // Update the checkAndRequestPermissions function
  const checkAndRequestPermissions = async () => {
    try {
      // For mobile browsers, we need to handle permissions differently
      if (isMobile) {
        // First check if permissions are already granted
        const permissions = await Promise.all([
          navigator.permissions.query({ name: "camera" as PermissionName }),
          navigator.permissions.query({ name: "microphone" as PermissionName }),
        ]);

        const [cameraPermission, micPermission] = permissions;

        if (
          cameraPermission.state === "denied" ||
          micPermission.state === "denied"
        ) {
          setMediaError(
            "Camera or microphone access denied. Please enable permissions in your browser settings and reload the page."
          );
          return false;
        }

        try {
          // Request both permissions at once for mobile
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });

          // Stop the test stream immediately
          stream.getTracks().forEach((track) => track.stop());

          setCameraPermission("granted");
          setMicPermission("granted");
          return true;
        } catch (error) {
          console.error("Mobile permission error:", error);
          if (error instanceof DOMException) {
            if (error.name === "NotAllowedError") {
              setMediaError(
                "Please grant camera and microphone permissions to join the meeting. If permissions are blocked, please enable them in your browser settings."
              );
            } else if (error.name === "NotFoundError") {
              setMediaError(
                "Could not find camera or microphone. Please check your device settings."
              );
            } else if (
              error.name === "NotReadableError" ||
              error.name === "AbortError"
            ) {
              setMediaError(
                "Could not access your camera or microphone. Please make sure no other app is using them and try again."
              );
            }
          }
          return false;
        }
      } else {
        // Desktop permission handling (existing code)
        // ... existing code for desktop permissions ...
      }
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
      const initializeMedia = async () => {
        try {
          // Check permissions first
          const permissionsGranted = await checkAndRequestPermissions();
          if (!permissionsGranted) {
            return;
          }

          // Now get the media stream with the proper constraints
          const mediaStream = await navigator.mediaDevices
            .getUserMedia(getMediaConstraints())
            .catch((error) => {
              if (error instanceof DOMException) {
                if (error.name === "NotAllowedError") {
                  if (!cameraPermission) {
                    setMediaError(
                      "Camera permission is required. Please grant access and reload."
                    );
                  } else if (!micPermission) {
                    setMediaError(
                      "Microphone permission is required. Please grant access and reload."
                    );
                  }
                } else if (error.name === "NotReadableError") {
                  setMediaError(
                    "Cannot access your camera or microphone. They might be in use by another application."
                  );
                } else {
                  setMediaError(
                    `Error accessing media devices: ${error.message}`
                  );
                }
              }
              throw error;
            });

          if (!mediaStream) return;

          setStream(mediaStream);
          if (userVideoRef.current) {
            userVideoRef.current.srcObject = mediaStream;
          }

          // Initialize socket connection after media is ready
          socketRef.current = io(
            process.env.NEXT_PUBLIC_SIGNALING_SERVER_URL || "",
            {
              transports: ["websocket", "polling"],
            }
          );

          socketRef.current.emit("join room", {
            roomID: params.meetingCode,
            userName: user.name || "Anonymous",
            isMuted: !isMicOn,
            isCameraOff: !isCameraOn,
          });

          // Update host status when receiving user list
          socketRef.current.on("all users", (users: User[]) => {
            const currentUser = users.find(
              (u: User) => u.id === socketRef.current?.id
            );
            setIsHost(currentUser?.isHost || false);
            const peers: PeerData[] = [];
            users.forEach(
              ({ id: userID, userName, isMuted, isCameraOff }: User) => {
                if (socketRef.current && socketRef.current.id) {
                  const peer = createPeer(
                    userID,
                    socketRef.current.id,
                    mediaStream
                  );
                  peersRef.current.push({
                    peerID: userID,
                    peer,
                    userName,
                  });
                  peers.push({ peer, userName, isMuted, isCameraOff });
                }
              }
            );
            setPeers(peers);
          });

          socketRef.current.on(
            "user joined",
            (payload: {
              signal: Peer.SignalData;
              callerID: string;
              userName: string;
            }) => {
              const peer = addPeer(
                payload.signal,
                payload.callerID,
                mediaStream
              );
              peersRef.current.push({
                peerID: payload.callerID,
                peer,
                userName: payload.userName,
              });
              setPeers((peers) => [
                ...peers,
                {
                  peer,
                  userName: payload.userName,
                  isMuted: false,
                  isCameraOff: false,
                },
              ]);
            }
          );

          socketRef.current.on(
            "receiving returned signal",
            (payload: { id: string; signal: Peer.SignalData }) => {
              const item = peersRef.current.find(
                (p) => p.peerID === payload.id
              );
              item?.peer.signal(payload.signal);
            }
          );

          socketRef.current.on("user left", (id: string) => {
            const peerObj = peersRef.current.find((p) => p.peerID === id);
            if (peerObj) {
              peerObj.peer.destroy();
            }
            const peers = peersRef.current.filter((p) => p.peerID !== id);
            peersRef.current = peers;
            setPeers(
              peers.map(({ peer, userName }) => ({
                peer,
                userName,
                isMuted: false,
                isCameraOff: false,
              }))
            );
          });

          socketRef.current.on("peer_mute_status", ({ peerId, isMuted }) => {
            updatePeerMuteStatus(peerId, isMuted);
          });

          socketRef.current.on(
            "peer_camera_status",
            ({ peerId, isCameraOff }) => {
              updatePeerCameraStatus(peerId, isCameraOff);
            }
          );

          // Handle host status changes
          socketRef.current.on("host_changed", ({ newHostId }) => {
            setIsHost(socketRef.current?.id === newHostId);
          });
        } catch (err) {
          console.error("Error in initializeMedia:", err);
          // Error handling is now done in the getUserMedia catch block above
        }
      };

      if (navigator.mediaDevices) {
        initializeMedia();
      } else {
        setMediaError(
          "Your browser doesn't support media devices. Please try using a different browser."
        );
      }

      return () => {
        socketRef.current?.disconnect();
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
      };
    }
  }, [
    user,
    params.meetingCode,
    getMediaConstraints,
    isMicOn,
    isCameraOn,
    isMobile,
  ]);

  useEffect(() => {
    if (searchParams && searchParams.get("new") === "true") {
      setShowNewMeetingModal(true);
    }
  }, [searchParams]);

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
      socketRef.current?.emit("sending signal", {
        userToSignal,
        callerID,
        signal,
        userName: user?.name || "Anonymous",
      });
    });

    return peer;
  }

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
      socketRef.current?.emit("returning signal", { signal, callerID });
    });

    peer.signal(incomingSignal);

    return peer;
  }

  const toggleMic = () => {
    if (stream) {
      stream.getAudioTracks().forEach((track) => (track.enabled = !isMicOn));
      setIsMicOn(!isMicOn);
      socketRef.current?.emit("mute_status", { isMuted: isMicOn });
    }
  };

  const toggleCamera = () => {
    if (stream) {
      stream.getVideoTracks().forEach((track) => (track.enabled = !isCameraOn));
      setIsCameraOn(!isCameraOn);
      socketRef.current?.emit("camera_status", { isCameraOff: !isCameraOn });
    }
  };

  const leaveMeeting = () => {
    socketRef.current?.disconnect();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    router.push("/");
  };

  const copyMeetingLink = () => {
    const meetingLink = `${window.location.origin}/pre-join/${params.meetingCode}`;
    navigator.clipboard.writeText(meetingLink);
    setShowCopyToast(true);
    setTimeout(() => setShowCopyToast(false), 2000);
  };

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: settings.audio.noiseSuppression,
        });

        // Replace video track in all peer connections
        peersRef.current.forEach(({ peer }) => {
          const videoTrack = screenStream.getVideoTracks()[0];
          const videoSender = (peer as any)._pc
            .getSenders()
            .find((sender: RTCRtpSender) => sender.track?.kind === "video");
          if (videoSender) {
            videoSender.replaceTrack(videoTrack);
          }
        });

        // Update local video display
        if (userVideoRef.current) {
          userVideoRef.current.srcObject = screenStream;
        }

        screenStream.getVideoTracks()[0].onended = () => {
          stopScreenSharing();
        };

        setScreenStream(screenStream);
        setIsScreenSharing(true);
      } else {
        stopScreenSharing();
      }
    } catch (error) {
      console.error("Error sharing screen:", error);
      setMediaError("Error sharing screen. Please try again.");
    }
  };

  const stopScreenSharing = () => {
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());

      if (stream) {
        // Revert to camera video track
        peersRef.current.forEach(({ peer }) => {
          const videoTrack = stream.getVideoTracks()[0];
          const videoSender = (peer as any)._pc
            .getSenders()
            .find((sender: RTCRtpSender) => sender.track?.kind === "video");
          if (videoSender) {
            videoSender.replaceTrack(videoTrack);
          }
        });

        // Update local video display
        if (userVideoRef.current) {
          userVideoRef.current.srcObject = stream;
        }
      }

      setScreenStream(null);
      setIsScreenSharing(false);
    }
  };

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
      console.error("Error toggling picture in picture:", error);
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
      console.error("Error toggling full screen:", error);
    }
  };

  const updatePeerMuteStatus = (peerId: string, isMuted: boolean) => {
    setPeers((currentPeers) =>
      currentPeers.map((peer) => {
        const peerRef = peersRef.current.find((p) => p.peerID === peerId);
        return peerRef?.peer === peer.peer ? { ...peer, isMuted } : peer;
      })
    );
  };

  const updatePeerCameraStatus = (peerId: string, isCameraOff: boolean) => {
    setPeers((currentPeers) =>
      currentPeers.map((peer) => {
        const peerRef = peersRef.current.find((p) => p.peerID === peerId);
        return peerRef?.peer === peer.peer ? { ...peer, isCameraOff } : peer;
      })
    );
  };

  // Function to detect supported resolutions
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
      setIsMicOn(false);
      if (stream) {
        stream.getAudioTracks().forEach((track) => (track.enabled = false));
      }
    }
  }, []);

  // Add camera switch function for mobile
  const switchCamera = async () => {
    if (!stream) return;

    try {
      // Stop all video tracks
      stream.getVideoTracks().forEach((track) => track.stop());

      // Get new stream with different camera
      const newStream = await navigator.mediaDevices.getUserMedia({
        ...getMediaConstraints(),
        video: {
          ...(getMediaConstraints().video as MediaTrackConstraints),
          facingMode: isBackCamera ? "user" : "environment",
        },
      });

      // Replace video track in all peer connections
      const newVideoTrack = newStream.getVideoTracks()[0];
      peersRef.current.forEach(({ peer }) => {
        const videoSender = (peer as any)._pc
          .getSenders()
          .find((sender: RTCRtpSender) => sender.track?.kind === "video");
        if (videoSender) {
          videoSender.replaceTrack(newVideoTrack);
        }
      });

      // Update local stream and video
      const audioTrack = stream.getAudioTracks()[0];
      setStream(new MediaStream([newVideoTrack, audioTrack]));
      if (userVideoRef.current) {
        userVideoRef.current.srcObject = new MediaStream([
          newVideoTrack,
          audioTrack,
        ]);
      }

      setIsBackCamera(!isBackCamera);
    } catch (error) {
      console.error("Error switching camera:", error);
      setMediaError("Failed to switch camera. Please try again.");
    }
  };

  // Update the retry function
  const retryMediaAccess = async () => {
    setMediaError(null);
    setCameraPermission(null);
    setMicPermission(null);

    if (user) {
      // For mobile, we need to reload the page after permissions are granted
      if (isMobile) {
        window.location.reload();
        return;
      }

      // For desktop, try to reinitialize without reload
      const permissionsGranted = await checkAndRequestPermissions();
      if (permissionsGranted) {
        try {
          const mediaStream = await navigator.mediaDevices.getUserMedia(
            getMediaConstraints()
          );
          setStream(mediaStream);
          if (userVideoRef.current) {
            userVideoRef.current.srcObject = mediaStream;
          }
        } catch (error) {
          console.error("Error retrying media access:", error);
          setMediaError(
            "Failed to access devices. Please check your permissions and try again."
          );
        }
      }
    }
  };

  // Update host action handlers
  const handleHostAction = (action: string, targetId: string) => {
    if (!isHost || !socketRef.current) return;

    socketRef.current.emit("host_action", {
      roomId: params.meetingCode,
      action,
      targetId,
    });
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return null;
  }

  const getVideoLayout = () => {
    const totalParticipants = peers.length + 1;

    if (isScreenSharing) {
      return "w-1/4 h-1/4 bottom-4 right-4";
    }

    switch (totalParticipants) {
      case 1:
        return "w-full h-full";
      case 2:
        return "w-1/4 h-1/4 bottom-4 right-4";
      case 3:
      case 4:
        return "w-1/2 h-1/2";
      default:
        return "w-1/3 h-1/3";
    }
  };

  return (
    <TooltipProvider>
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
              <AnimatePresence>
                <motion.div
                  key="main-video"
                  className="absolute inset-0"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card className="w-full h-full overflow-hidden rounded-lg relative">
                    {peers.length > 0 ? (
                      peers[0].isCameraOff ? (
                        <UserAvatar name={peers[0].userName} />
                      ) : (
                        <Video peer={peers[0].peer} />
                      )
                    ) : !isCameraOn ? (
                      <UserAvatar name={user.name || "You"} />
                    ) : (
                      <video
                        ref={userVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    )}
                    <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded flex items-center space-x-2">
                      <span>
                        {peers.length > 0
                          ? peers[0].userName
                          : user.name || "You"}{" "}
                        {isScreenSharing && "(Screen)"}
                      </span>
                      {peers.length > 0
                        ? peers[0].isMuted && <MicOff className="h-4 w-4" />
                        : !isMicOn && <MicOff className="h-4 w-4" />}
                    </div>
                  </Card>
                </motion.div>

                {peers.length > 0 && (
                  <motion.div
                    key="self-video"
                    className={`absolute ${getVideoLayout()}`}
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
                          className="w-full h-full object-cover"
                        />
                      )}
                      <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded flex items-center space-x-2">
                        <span>{user.name || "You"}</span>
                        {!isMicOn && <MicOff className="h-4 w-4" />}
                      </div>
                    </Card>
                  </motion.div>
                )}

                {peers
                  .slice(1)
                  .map(({ peer, userName, isMuted, isCameraOff }, index) => (
                    <motion.div
                      key={index + 1}
                      className={`absolute ${getVideoLayout()}`}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.3 }}
                      style={{
                        top: `${Math.floor((index + 1) / 3) * 33.33}%`,
                        left: `${((index + 1) % 3) * 33.33}%`,
                      }}
                    >
                      <Card className="w-full h-full overflow-hidden rounded-lg relative">
                        {isCameraOff ? (
                          <UserAvatar name={userName} />
                        ) : (
                          <Video peer={peer} />
                        )}
                        <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded flex items-center space-x-2">
                          <span>{userName}</span>
                          {isMuted && <MicOff className="h-4 w-4" />}
                        </div>
                      </Card>
                    </motion.div>
                  ))}
              </AnimatePresence>
            </div>
          </div>
          <div className="p-2 sm:p-4 bg-white dark:bg-gray-800 shadow-lg">
            <div className="flex flex-wrap justify-center sm:justify-between items-center gap-2 max-w-4xl mx-auto">
              <div className="flex flex-wrap justify-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" onClick={toggleMic}>
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
                      onClick={toggleCamera}
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
                        onClick={toggleScreenShare}
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
                          <DropdownMenuRadioItem value="sidebar">
                            Sidebar View
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
            {sidebarContent === "chat" ? (
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
            ) : (
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
                    {peers.map(({ userName, isMuted, isCameraOff }, index) => (
                      <li
                        key={index}
                        className="flex items-center justify-between"
                      >
                        <span>{userName}</span>
                        <div className="flex items-center space-x-2">
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
                        </div>
                      </li>
                    ))}
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
                {isMobile &&
                  (cameraPermission === "denied" ||
                    micPermission === "denied") && (
                    <div className="text-sm mt-2 space-y-2">
                      <p>To fix this on mobile Chrome:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Tap the lock icon (🔒) in the address bar</li>
                        <li>Tap &ldquo;Site settings&rdquo;</li>
                        <li>Enable both Camera and Microphone permissions</li>
                        <li>Reload the page</li>
                      </ol>
                    </div>
                  )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={retryMediaAccess}
                  className="bg-white text-red-500 hover:bg-red-100"
                >
                  {isMobile ? "Reload Page" : "Retry Access"}
                </Button>
                {!isMobile && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => window.location.reload()}
                    className="bg-white text-red-500 hover:bg-red-100"
                  >
                    Reload Page
                  </Button>
                )}
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
      </div>
    </TooltipProvider>
  );
}

function Video({ peer }: { peer: Peer.Instance }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    peer.on("stream", (stream) => {
      if (ref.current) {
        ref.current.srcObject = stream;
      }
    });
  }, [peer]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      className="w-full h-full object-cover"
    />
  );
}
