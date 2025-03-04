import time
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import pipeline
import torch
import base64
import numpy as np
import logging
import os
from typing import Optional, List
import uvicorn
import sys
import signal

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add this after the imports
print(f"PyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA version: {torch.version.cuda}")
    print(f"GPU device: {torch.cuda.get_device_name(0)}")

# Check CUDA availability
device = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Using device: {device}")
if device == "cuda":
    logger.info(f"CUDA device: {torch.cuda.get_device_name(0)}")

# Initialize models with CUDA
try:
    logger.info("Loading Whisper model...")
    whisper = pipeline(
        "automatic-speech-recognition",
        "openai/whisper-small",
        device=device,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
    )
    logger.info("Whisper model loaded successfully")

    logger.info("Loading NLLB model for translation...")
    # Using NLLB-200 which supports 200+ languages
    nllb = pipeline(
        "translation",
        "facebook/nllb-200-distilled-600M",  # Smaller, faster version
        device=device,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        use_fast=False,
    )
    logger.info("NLLB model loaded successfully")

    # Language code mapping for common languages
    LANGUAGE_CODES = {
        "english": "eng_Latn",
        "hindi": "hin_Deva",
        "marathi": "mar_Deva",
        "spanish": "spa_Latn",
        "french": "fra_Latn",
        "german": "deu_Latn",
        "japanese": "jpn_Jpan",
        "korean": "kor_Hang",
        "chinese": "zho_Hans",
    }

except Exception as e:
    logger.error(f"Error loading models: {str(e)}")
    raise


class TranscriptionRequest(BaseModel):
    audio: str
    language: Optional[str] = "en"


class TranslationRequest(BaseModel):
    text: str
    target_lang: str


class SummarizationRequest(BaseModel):
    text: str


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "device": device,
        "cuda_available": torch.cuda.is_available(),
        "cuda_device": (
            torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
        ),
    }


@app.post("/transcribe")
async def transcribe(request: TranscriptionRequest):
    try:
        # Decode base64 audio
        audio_data = base64.b64decode(request.audio)
        audio_array = np.frombuffer(audio_data, dtype=np.float32)

        # Process with Whisper - simplified parameters for real-time
        result = whisper(
            audio_array,
            chunk_length_s=30,  # Process 30 seconds at a time
            stride_length_s=5,  # 5 second overlap between chunks
            return_timestamps=True,
            # Only use supported parameters
            generate_kwargs={
                "language": request.language if request.language else "en",
                "task": "transcribe",
            },
        )

        # Clean up the transcription
        text = result["text"].strip()

        # Remove any non-English characters if English is specified
        if request.language == "en":
            text = "".join(char for char in text if ord(char) < 128)

        return {
            "text": text,
            "confidence": result.get("confidence", 0.95),
            "language": result.get("language", "en"),
            "timestamp": int(time.time() * 1000),
        }
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/translate")
async def translate(request: TranslationRequest):
    try:
        # Convert language names to NLLB codes
        src_lang = LANGUAGE_CODES.get(request.src_lang.lower(), "eng_Latn")
        tgt_lang = LANGUAGE_CODES.get(request.target_lang.lower(), "hin_Deva")

        result = nllb(
            request.text,
            src_lang=src_lang,
            tgt_lang=tgt_lang,
            max_length=400,
            num_beams=5,  # Better translation quality
            do_sample=False,  # Deterministic output
        )

        return {
            "translated_text": result[0]["translation_text"],
            "confidence": result[0].get("score", 0.95),
            "source_language": request.src_lang,
            "target_language": request.target_lang,
        }
    except Exception as e:
        logger.error(f"Translation error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/summarize")
async def summarize(request: SummarizationRequest):
    try:
        result = distilbart(request.text, max_length=130, min_length=30)
        return {
            "summary": result[0]["summary_text"],
            "confidence": result[0].get("score", 0.95),
        }
    except Exception as e:
        logger.error(f"Summarization error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Add WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        try:
            await websocket.accept()
            self.active_connections.append(websocket)
            logger.info(
                f"New WebSocket connection. Active connections: {len(self.active_connections)}"
            )
        except Exception as e:
            logger.error(f"Error accepting WebSocket connection: {e}")
            raise

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(
                f"WebSocket disconnected. Active connections: {len(self.active_connections)}"
            )


manager = ConnectionManager()


# Add WebSocket endpoint for transcription
@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    try:
        await manager.connect(websocket)
        logger.info("New WebSocket connection established")

        while True:
            try:
                # Check connection state
                if websocket.client_state.DISCONNECTED:
                    logger.info("Client disconnected, breaking loop")
                    break

                # Receive and parse message
                message = await websocket.receive_json()
                request_id = message["requestId"]
                audio_data = np.array(message["audioData"], dtype=np.float32)
                language = message.get("language", "en")

                logger.info(f"Processing audio for request {request_id}")

                # Process with Whisper
                result = whisper(
                    audio_data,
                    chunk_length_s=30,
                    stride_length_s=5,
                    return_timestamps=True,
                    generate_kwargs={"language": language, "task": "transcribe"},
                )

                # Prepare and send response
                if not websocket.client_state.DISCONNECTED:
                    response = {
                        "requestId": request_id,
                        "text": result["text"].strip(),
                        "confidence": result.get("confidence", 0.95),
                        "language": result.get("language", "en"),
                        "timestamp": int(time.time() * 1000),
                    }

                    logger.info(
                        f"Sending transcription result for request {request_id}"
                    )
                    await websocket.send_json(response)

            except WebSocketDisconnect:
                logger.info("WebSocket disconnected")
                break
            except Exception as e:
                logger.error(f"Error processing audio: {str(e)}")
                if not websocket.client_state.DISCONNECTED and "requestId" in locals():
                    try:
                        error_response = {
                            "requestId": request_id,
                            "error": str(e),
                            "timestamp": int(time.time() * 1000),
                        }
                        await websocket.send_json(error_response)
                    except:
                        logger.error("Failed to send error response")
                        break

    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
    finally:
        logger.info("Cleaning up WebSocket connection")
        manager.disconnect(websocket)


def signal_handler(sig, frame):
    logger.info("Shutting down gracefully...")
    sys.exit(0)


if __name__ == "__main__":
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        # Run with increased timeout and WebSocket support
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=5000,
            timeout_keep_alive=120,  # Increased timeout
            loop="auto",
            log_level="info",
            ws_ping_interval=30,  # Keep WebSocket alive
            ws_ping_timeout=60,  # WebSocket timeout
        )
    except Exception as e:
        logger.error(f"Server error: {str(e)}")
        sys.exit(1)
