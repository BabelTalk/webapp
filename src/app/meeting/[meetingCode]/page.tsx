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
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PeerData {
  peer: Peer.Instance;
  userName: string;
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
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [showNewMeetingModal, setShowNewMeetingModal] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const userVideoRef = useRef<HTMLVideoElement>(null);
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
          socketRef.current = io("", {
            path: "/api/socket/io",
            addTrailingSlash: false,
          });

          socketRef.current.emit("join room", {
            roomID: params.meetingCode,
            userName: user.name || "Anonymous",
          });

          socketRef.current.on(
            "all users",
            (users: { id: string; userName: string }[]) => {
              const peers: PeerData[] = [];
              users.forEach(({ id: userID, userName }) => {
                if (socketRef.current && socketRef.current.id) {
                  const peer = createPeer(userID, socketRef.current.id, stream);
                  peersRef.current.push({
                    peerID: userID,
                    peer,
                    userName,
                  });
                  peers.push({ peer, userName });
                }
              });
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
                { peer, userName: payload.userName },
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
              }))
            );
          });
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
    }
  };

  const toggleCamera = () => {
    if (stream) {
      stream.getVideoTracks().forEach((track) => (track.enabled = !isCameraOn));
      setIsCameraOn(!isCameraOn);
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

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return null;
  }

  const getVideoLayout = () => {
    const totalParticipants = peers.length + 1;
    if (totalParticipants === 1) {
      return "w-full h-full";
    } else if (totalParticipants === 2) {
      return "w-full h-full";
    } else if (totalParticipants <= 4) {
      return "w-1/2 h-1/2";
    } else {
      return "w-1/3 h-1/3";
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900">
      <div className="flex-1 p-4 overflow-hidden">
        <div className="relative w-full h-full">
          <AnimatePresence>
            {peers.length === 1 && (
              <motion.div
                key="peer-video"
                className="absolute inset-0"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.3 }}
              >
                <Card
                  className={`w-full h-full overflow-hidden rounded-lg relative`}
                >
                  <Video peer={peers[0].peer} />
                  <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                    {peers[0].userName}
                  </div>
                </Card>
              </motion.div>
            )}
            <motion.div
              key="user-video"
              className={`absolute ${
                peers.length === 1
                  ? "bottom-4 right-4 w-1/4 h-1/4"
                  : getVideoLayout()
              }`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.3 }}
            >
              <Card
                className={`w-full h-full overflow-hidden rounded-lg relative `}
              >
                <video
                  ref={userVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                  {user.name || "You"}
                </div>
              </Card>
            </motion.div>
            {peers.length > 1 &&
              peers.map(({ peer, userName }, index) => (
                <motion.div
                  key={index}
                  className={`absolute ${getVideoLayout()}`}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.3 }}
                  style={{
                    top: `${Math.floor(index / 3) * 33.33}%`,
                    left: `${(index % 3) * 33.33}%`,
                  }}
                >
                  <Card
                    className={`w-full h-full overflow-hidden rounded-lg relative `}
                  >
                    <Video peer={peer} />
                    <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                      {userName}
                    </div>
                  </Card>
                </motion.div>
              ))}
          </AnimatePresence>
        </div>
      </div>
      <div className="p-4 bg-white dark:bg-gray-800 shadow-lg">
        <div className="flex justify-between items-center">
          <div className="flex space-x-4">
            <Button variant="outline" size="icon" onClick={toggleMic}>
              {isMicOn ? <Mic /> : <MicOff />}
            </Button>
            <Button variant="outline" size="icon" onClick={toggleCamera}>
              {isCameraOn ? <VideoIcon /> : <VideoOff />}
            </Button>
          </div>
          <Button variant="destructive" onClick={leaveMeeting}>
            <PhoneOff className="mr-2 h-4 w-4" /> Leave Meeting
          </Button>
          <Button variant="outline" onClick={copyMeetingLink}>
            <Copy className="mr-2 h-4 w-4" /> Copy Meeting Link
          </Button>
        </div>
      </div>
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
      <Dialog open={showNewMeetingModal} onOpenChange={setShowNewMeetingModal}>
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
    </div>
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
