import React, { useState, useEffect, useRef, useTransition } from "react";
import { io } from "socket.io-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Paperclip,
  Send,
  Reply,
  Smile,
  X,
  Check,
  CheckCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

interface ChatProps {
  roomID: string;
  userName: string;
  isHost: boolean;
  onToggleUserAudio?: (userId: string) => void;
  onToggleUserVideo?: (userId: string) => void;
}

interface Reaction {
  id: string;
  emoji: string;
  userName: string;
  timestamp: Date;
}

interface Message {
  id: string;
  userName: string;
  content: string;
  timestamp: Date;
  replyTo?: Message;
  reactions: Reaction[];
  status?: "sending" | "sent" | "delivered";
}

const EMOJI_OPTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const Chat: React.FC<ChatProps> = ({
  roomID,
  userName,
  isHost,
  onToggleUserAudio,
  onToggleUserVideo,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const socket = io(process.env.NEXT_PUBLIC_SIGNALING_SERVER_URL || "", {
    transports: ["websocket", "polling"],
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Load chat history when joining
  useEffect(() => {
    const loadChatHistory = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/messages?roomId=${roomID}`);
        if (response.ok) {
          const history = await response.json();
          setMessages(history);
          scrollToBottom();
        }
      } catch (error) {
        console.error("Error loading chat history:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadChatHistory();
  }, [roomID]);

  useEffect(() => {
    socket.on("receive message", (message: Message) => {
      setMessages((prevMessages) => {
        const existingMessage = prevMessages.find(
          (msg) =>
            msg.content === message.content &&
            msg.userName === message.userName &&
            Math.abs(
              new Date(msg.timestamp).getTime() -
                new Date(message.timestamp).getTime()
            ) < 1000
        );

        if (existingMessage) {
          return prevMessages.map((msg) =>
            msg === existingMessage ? { ...message, status: "delivered" } : msg
          );
        }

        // Send delivery confirmation
        socket.emit("message_delivered", {
          messageId: message.id,
          userName: message.userName,
        });

        return [...prevMessages, { ...message, status: "delivered" }];
      });
      scrollToBottom();
    });

    socket.on("message_delivered", ({ messageId, userName: deliveredTo }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, status: "delivered" } : msg
        )
      );
    });

    socket.on(
      "message reaction",
      ({ messageId, reaction, previousReaction }) => {
        setMessages((prevMessages) =>
          prevMessages.map((msg) => {
            if (msg.id === messageId) {
              // Remove previous reaction if it exists
              const filteredReactions = previousReaction
                ? msg.reactions.filter(
                    (r) =>
                      !(
                        r.userName === reaction.userName &&
                        r.emoji === previousReaction.emoji
                      )
                  )
                : msg.reactions;

              return {
                ...msg,
                reactions: [...filteredReactions, reaction],
              };
            }
            return msg;
          })
        );
      }
    );

    return () => {
      socket.off("receive message");
      socket.off("message_delivered");
      socket.off("message reaction");
    };
  }, [socket]);

  const sendMessage = async () => {
    if (newMessage.trim()) {
      // Create optimistic message
      const optimisticMessage: Message = {
        id: Math.random().toString(),
        content: newMessage,
        userName,
        timestamp: new Date(),
        reactions: [],
        status: "sending",
        replyTo: replyingTo || undefined,
      };

      // Optimistically add the message
      setMessages((prev) => [...prev, optimisticMessage]);
      scrollToBottom();

      // Clear input immediately
      setNewMessage("");
      setReplyingTo(null);

      try {
        startTransition(async () => {
          const response = await fetch("/api/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              roomId: roomID,
              content: newMessage,
              userName,
              replyToId: replyingTo?.id,
            }),
          });

          if (!response.ok) {
            throw new Error("Failed to save message");
          }

          const savedMessage = await response.json();

          // Update status to sent
          setMessages((prev) =>
            prev.map((msg) =>
              msg === optimisticMessage
                ? { ...savedMessage, status: "sent" }
                : msg
            )
          );

          // Emit the saved message
          socket.emit("send message", savedMessage);
        });
      } catch (error) {
        console.error("Error sending message:", error);
        setMessages((prev) => prev.filter((msg) => msg !== optimisticMessage));
      }
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (!message) return;

    // Check if user already has a reaction
    const existingReaction = message.reactions.find(
      (r) => r.userName === userName
    );

    // If clicking the same emoji, remove it
    if (existingReaction && existingReaction.emoji === emoji) {
      try {
        const response = await fetch(`/api/reactions/${messageId}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userName,
            emoji,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to remove reaction");
        }

        // Remove reaction locally
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  reactions: msg.reactions.filter(
                    (r) => !(r.userName === userName && r.emoji === emoji)
                  ),
                }
              : msg
          )
        );

        // Emit reaction removal
        socket.emit("remove reaction", { messageId, userName, emoji });
      } catch (error) {
        console.error("Error removing reaction:", error);
      }
      return;
    }

    // Create optimistic reaction
    const optimisticReaction: Reaction = {
      id: Math.random().toString(),
      emoji,
      userName,
      timestamp: new Date(),
    };

    // Optimistically update reaction
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              reactions: [
                ...msg.reactions.filter((r) => r.userName !== userName),
                optimisticReaction,
              ],
            }
          : msg
      )
    );

    try {
      const response = await fetch("/api/reactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messageId,
          emoji,
          userName,
          previousReaction: existingReaction,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save reaction");
      }

      const savedReaction = await response.json();

      // Emit the reaction update
      socket.emit("add reaction", {
        messageId,
        reaction: savedReaction,
        previousReaction: existingReaction,
      });
    } catch (error) {
      console.error("Error adding reaction:", error);
      // Revert optimistic update
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                reactions: existingReaction
                  ? [
                      ...msg.reactions.filter((r) => r.userName !== userName),
                      existingReaction,
                    ]
                  : msg.reactions.filter((r) => r.userName !== userName),
              }
            : msg
        )
      );
    }
  };

  const cancelReply = () => {
    setReplyingTo(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = async () => {
    if (!isHost) return;

    try {
      const response = await fetch(
        `/api/messages?roomId=${roomID}&isHost=true`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        setMessages([]);
        socket.emit("chat_cleared", { roomId: roomID });
      }
    } catch (error) {
      console.error("Error clearing chat:", error);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages Area */}
      <div className="flex justify-between items-center p-4 border-b">
        <h2 className="text-lg font-semibold">Chat</h2>
        {isHost && (
          <Button
            variant="destructive"
            size="sm"
            onClick={clearChat}
            className="text-xs"
          >
            Clear Chat
          </Button>
        )}
      </div>
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.map((msg) => (
          <ContextMenu key={msg.id}>
            <ContextMenuTrigger>
              <div
                className={cn(
                  "flex items-start gap-2",
                  msg.userName === userName ? "flex-row-reverse" : "flex-row"
                )}
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback>
                    {msg.userName[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div
                  className={cn(
                    "flex flex-col max-w-[70%]",
                    msg.userName === userName ? "items-end" : "items-start"
                  )}
                >
                  {msg.replyTo && (
                    <div
                      className={cn(
                        "text-xs text-muted-foreground mb-1 px-3 py-2 rounded bg-muted/30 border-l-2 border-primary",
                        "flex flex-col gap-1 max-w-[300px] overflow-hidden"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Reply className="h-3 w-3" />
                        <span className="font-medium">
                          {msg.replyTo.userName}
                        </span>
                      </div>
                      <p className="truncate">{msg.replyTo.content}</p>
                    </div>
                  )}
                  <div
                    className={cn(
                      "rounded-lg px-3 py-2",
                      msg.userName === userName
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    <p className="text-sm break-words">{msg.content}</p>
                  </div>
                  {msg.reactions.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {Object.entries(
                        msg.reactions.reduce((acc, { emoji, userName }) => {
                          acc[emoji] = (acc[emoji] || []).concat(userName);
                          return acc;
                        }, {} as Record<string, string[]>)
                      ).map(([emoji, users]) => (
                        <button
                          key={emoji}
                          onClick={() => handleReaction(msg.id, emoji)}
                          className={cn(
                            "bg-muted hover:bg-muted/80 rounded-full px-2 py-0.5 text-xs flex items-center gap-1",
                            users.includes(userName) && "ring-1 ring-primary"
                          )}
                          title={users.join(", ")}
                        >
                          <span>{emoji}</span>
                          <span>{users.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                    {msg.userName === userName && (
                      <span className="text-xs text-muted-foreground">
                        {msg.status === "sending" && (
                          <Check className="h-3 w-3" />
                        )}
                        {msg.status === "sent" && <Check className="h-3 w-3" />}
                        {msg.status === "delivered" && (
                          <CheckCheck className="h-3 w-3" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => setReplyingTo(msg)}>
                <Reply className="h-4 w-4 mr-2" />
                Reply
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem>
                <Smile className="h-4 w-4 mr-2" />
                React
                <div className="ml-2 flex gap-1">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleReaction(msg.id, emoji)}
                      className={cn(
                        "hover:bg-accent rounded p-1",
                        msg.reactions.some(
                          (r) => r.userName === userName && r.emoji === emoji
                        ) && "ring-1 ring-primary"
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply Preview */}
      {replyingTo && (
        <div className="border-t p-2 bg-muted/50 flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1 max-w-[calc(100%-80px)]">
            <Reply className="h-4 w-4 shrink-0" />
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium">{replyingTo.userName}</span>
              <span className="text-sm text-muted-foreground truncate">
                {replyingTo.content}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={cancelReply}
            className="shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t p-4 bg-background">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            title="Attach file"
            disabled={isLoading}
          >
            <Paperclip className="h-5 w-5" />
          </Button>
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={`Type a message${replyingTo ? " (replying)" : ""}...`}
            className="flex-1"
            disabled={isLoading}
          />
          <Button
            onClick={sendMessage}
            size="icon"
            className="shrink-0"
            disabled={!newMessage.trim() || isLoading}
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Chat;
