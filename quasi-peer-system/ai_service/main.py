import logging
import numpy as np
import torch
from concurrent import futures
import grpc
import whisper
from typing import Iterator

# Import generated protobuf code
import transcription_pb2
import transcription_pb2_grpc

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Check CUDA availability
device = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Using device: {device}")


class TranscriptionServicer(transcription_pb2_grpc.TranscriptionServiceServicer):
    def __init__(self):
        self.model = whisper.load_model("base")
        self.active_streams = {}
        # 30ms * 16000Hz = 480 samples per frame
        self.FRAME_SIZE = 480
        # Buffer 2 seconds of audio (16000Hz * 2 = 32000 samples)
        self.BUFFER_SIZE = 32000
        self.audio_buffers = {}
        self.sample_rate = 16000  # Whisper expects 16kHz audio

    def preprocess_audio(self, audio_data: np.ndarray) -> np.ndarray:
        """Preprocess audio data for Whisper model."""
        try:
            # Ensure we're working with float32
            audio_data = audio_data.astype(np.float32)

            # Normalize audio to [-1, 1] range if not already
            if np.abs(audio_data).max() > 1.0:
                audio_data = audio_data / 32768.0  # Normalize 16-bit audio

            # Apply basic noise reduction (optional)
            # Remove DC offset
            audio_data = audio_data - np.mean(audio_data)

            # Ensure audio doesn't contain NaN or Inf values
            audio_data = np.nan_to_num(audio_data)

            # Ensure correct shape for Whisper
            if len(audio_data.shape) == 1:
                # Whisper expects audio in shape (n_samples,)
                return audio_data
            elif len(audio_data.shape) == 2:
                # If stereo, convert to mono by averaging channels
                return np.mean(audio_data, axis=1)
            else:
                raise ValueError(f"Unexpected audio shape: {audio_data.shape}")

        except Exception as e:
            logger.error(f"Error in preprocessing: {str(e)}")
            raise

    def StreamTranscription(
        self,
        request_iterator: Iterator[transcription_pb2.AudioRequest],
        context: grpc.ServicerContext,
    ) -> Iterator[transcription_pb2.TranscriptionResponse]:
        try:
            for request in request_iterator:
                user_id = request.user_id

                # Initialize buffer for new user
                if user_id not in self.audio_buffers:
                    self.audio_buffers[user_id] = np.array([], dtype=np.float32)

                try:
                    # Convert incoming audio to numpy array
                    audio_chunk = np.frombuffer(request.audio_data, dtype=np.float32)

                    # Append to buffer
                    self.audio_buffers[user_id] = np.append(
                        self.audio_buffers[user_id], audio_chunk
                    )

                    # Process when buffer is full
                    if len(self.audio_buffers[user_id]) >= self.BUFFER_SIZE:
                        logger.info(
                            f"Processing audio buffer of size: {len(self.audio_buffers[user_id])}"
                        )

                        # Preprocess audio
                        processed_audio = self.preprocess_audio(
                            self.audio_buffers[user_id]
                        )

                        # Clear buffer before processing to avoid duplicate processing
                        self.audio_buffers[user_id] = np.array([], dtype=np.float32)

                        try:
                            # Process with Whisper
                            with torch.no_grad():
                                result = self.model.transcribe(
                                    processed_audio,
                                    language="en",
                                    task="transcribe",
                                    fp16=False,  # Disable fp16 to avoid NaN issues
                                )

                            if result["text"].strip():
                                logger.info(f"Transcription result: {result['text']}")
                                yield transcription_pb2.TranscriptionResponse(
                                    text=result["text"],
                                    confidence=float(result.get("confidence", 0.0)),
                                    user_id=request.user_id,
                                    room_id=request.room_id,
                                    is_final=True,
                                    error="",
                                )
                            else:
                                logger.info("No text detected in audio")

                        except Exception as e:
                            logger.error(f"Error in Whisper processing: {str(e)}")
                            yield transcription_pb2.TranscriptionResponse(
                                text="",
                                confidence=0.0,
                                user_id=request.user_id,
                                room_id=request.room_id,
                                is_final=True,
                                error=str(e),
                            )

                except Exception as e:
                    logger.error(f"Error processing audio chunk: {str(e)}")

        except Exception as e:
            logger.error(f"Stream error: {str(e)}")
        finally:
            # Clean up buffer when stream ends
            if user_id in self.audio_buffers:
                del self.audio_buffers[user_id]


def serve():
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=10),
        options=[
            ("grpc.max_send_message_length", 83886080),
            ("grpc.max_receive_message_length", 83886080),
        ],
    )

    transcription_pb2_grpc.add_TranscriptionServiceServicer_to_server(
        TranscriptionServicer(), server
    )

    server.add_insecure_port("[::]:50051")
    server.start()
    logger.info("Transcription server started on port 50051")
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
