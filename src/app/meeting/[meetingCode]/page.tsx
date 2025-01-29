"use client";

import { useState, useEffect, useRef } from "react";
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

  const socketRef = useRef<Socket | null>(null);
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const peersRef = useRef<
    { peerID: string; peer: Peer.Instance; userName: string }[]
  >([]);

  useEffect(() => {
    if (!user && !isLoading) {
      router.push("/");
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    if (user) {
      const getMediaDevices = async () => {
        try {
          const permissions = await navigator.permissions.query({
            name: "camera" as PermissionName,
          });
          if (permissions.state === "denied") {
            setMediaError("Camera access denied.");
            return;
          }

          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
          setStream(stream);
          if (userVideoRef.current) {
            userVideoRef.current.srcObject = stream;
          }
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

          socketRef.current.on(
            "all users",
            (
              users: {
                id: string;
                userName: string;
                isMuted: boolean;
                isCameraOff: boolean;
              }[]
            ) => {
              const peers: PeerData[] = [];
              users.forEach(
                ({ id: userID, userName, isMuted, isCameraOff }) => {
                  if (socketRef.current && socketRef.current.id) {
                    const peer = createPeer(
                      userID,
                      socketRef.current.id,
                      stream
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
            }
          );

          socketRef.current.on(
            "user joined",
            (payload: {
              signal: Peer.SignalData;
              callerID: string;
              userName: string;
            }) => {
              const peer = addPeer(payload.signal, payload.callerID, stream);
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
        } catch (err) {
          console.error("Error accessing media devices:", err);
          setMediaError("Error accessing media devices.");
        }
      };

      if (navigator.mediaDevices) {
        getMediaDevices();
      } else {
        setMediaError("Media devices are not supported on this device.");
      }

      return () => {
        socketRef.current?.disconnect();
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
      };
    }
  }, [user, params.meetingCode]);

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
      <div
        className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900"
        ref={containerRef}
      >
        <div className="flex-1 p-4 overflow-hidden">
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
        <div className="p-4 bg-white dark:bg-gray-800 shadow-lg">
          <div className="flex justify-between items-center max-w-4xl mx-auto">
            <div className="flex space-x-2">
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
                  <Button variant="outline" size="icon" onClick={toggleCamera}>
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
            </div>

            <Button variant="destructive" onClick={leaveMeeting}>
              <PhoneOff className="mr-2 h-4 w-4" /> Leave Meeting
            </Button>

            <div className="flex space-x-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" onClick={copyMeetingLink}>
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
                  <DropdownMenuItem onClick={() => setShowSettingsModal(true)}>
                    <Settings className="mr-2 h-4 w-4" /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={togglePictureInPicture}>
                    <Minimize2 className="mr-2 h-4 w-4" /> Picture in Picture
                  </DropdownMenuItem>
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

        <Dialog open={showSettingsModal} onOpenChange={setShowSettingsModal}>
          <DialogContent className="sm:max-w-[425px]">
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
            className="fixed bottom-4 left-4 bg-red-500 text-white p-2 rounded"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
          >
            {mediaError}
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
