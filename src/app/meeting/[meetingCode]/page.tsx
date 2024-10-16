"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import io, { Socket } from "socket.io-client";
import Peer from "simple-peer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";

export default function Meeting({
  params,
}: {
  params: { meetingCode: string };
}) {
  const { user, isLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [peers, setPeers] = useState<Peer.Instance[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [showNewMeetingModal, setShowNewMeetingModal] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<{ peerID: string; peer: Peer.Instance }[]>([]);

  useEffect(() => {
    if (!user && !isLoading) {
      router.push("/");
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    if (user) {
      const getMediaDevices = async () => {
        try {
          // Check for permissions
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
            path: "/api/socket",
          });

          socketRef.current.emit("join room", params.meetingCode);

          socketRef.current.on("all users", (users: string[]) => {
            const peers: Peer.Instance[] = [];
            users.forEach((userID) => {
              if (socketRef.current && socketRef.current.id) {
                const peer = createPeer(userID, socketRef.current.id, stream);
                peersRef.current.push({
                  peerID: userID,
                  peer,
                });
                peers.push(peer);
              }
            });
            setPeers(peers);
          });

          socketRef.current.on(
            "user joined",
            (payload: { signal: Peer.SignalData; callerID: string }) => {
              const peer = addPeer(payload.signal, payload.callerID, stream);
              peersRef.current.push({
                peerID: payload.callerID,
                peer,
              });
              setPeers((peers) => [...peers, peer]);
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
            setPeers(peers.map((p) => p.peer));
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
  }, [user, params.meetingCode, stream]);

  useEffect(() => {
    if (searchParams.get("new") === "true") {
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

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900">
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card className="aspect-video bg-black">
            <video
              ref={userVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          </Card>
          {peers.map((peer, index) => (
            <Card key={index} className="aspect-video bg-black">
              <Video peer={peer} />
            </Card>
          ))}
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
        <div className="fixed bottom-4 right-4 bg-green-500 text-white p-2 rounded">
          Meeting link copied to clipboard!
        </div>
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
        <div className="fixed bottom-4 left-4 bg-red-500 text-white p-2 rounded">
          {mediaError}
        </div>
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
