"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";

const PreJoin = ({ params }: { params: { meetingCode: string } }) => {
  const { user, isLoading } = useUser();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

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
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
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
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
      };
    }
  }, [user, stream]);

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

  const joinMeeting = () => {
    router.push(`/meeting/${params.meetingCode}`);
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join Meeting: {params.meetingCode}</CardTitle>
        </CardHeader>
        <CardContent>
          {mediaError ? (
            <div className="text-red-500">{mediaError}</div>
          ) : (
            <>
              <div className="aspect-video bg-black rounded-lg overflow-hidden mb-4">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="mic"
                    checked={isMicOn}
                    onCheckedChange={toggleMic}
                  />
                  <Label htmlFor="mic">{isMicOn ? <Mic /> : <MicOff />}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="camera"
                    checked={isCameraOn}
                    onCheckedChange={toggleCamera}
                  />
                  <Label htmlFor="camera">
                    {isCameraOn ? <Video /> : <VideoOff />}
                  </Label>
                </div>
              </div>
            </>
          )}
        </CardContent>
        <CardFooter>
          <Button onClick={joinMeeting} className="w-full">
            Join Meeting
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default PreJoin;
