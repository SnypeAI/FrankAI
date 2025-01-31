# Frank - AI Voice Assistant

Frank is a sophisticated AI voice assistant that combines state-of-the-art speech recognition, natural language processing, and text-to-speech capabilities. Built with a modern tech stack, it offers real-time voice interaction with advanced AI models.

## Features

- **Real-time Speech Recognition**: Using Facebook's MMS-1B model for accurate transcription
- **Natural Language Processing**: Integration with advanced LLM for intelligent responses
- **Text-to-Speech**: High-quality voice synthesis using ElevenLabs
- **WebSocket Communication**: Real-time bidirectional communication
- **Modern UI**: Built with Next.js and Tailwind CSS
- **Debug Tools**: Comprehensive debugging panel for system testing

## Tech Stack

### Frontend
- Next.js 13+
- TypeScript
- Tailwind CSS
- Framer Motion
- WebSocket API
- Web Audio API

### Backend
- FastAPI
- Python 3.11+
- PyTorch
- Hugging Face Transformers
- WebSocket
- ElevenLabs API

## Prerequisites

- Python 3.11 or higher
- Node.js 18 or higher
- npm or yarn
- Git

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/Frank.git
cd Frank
```

2. Install backend dependencies:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate
pip install -r requirements.txt
```

3. Install frontend dependencies:
```bash
npm install
# or
yarn install
```

4. Create a .env file in the root directory and add your API keys:
```env
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=your_voice_id
```

## Running the Application

1. Start the backend server:
```bash
./backend.sh
# or on Windows:
backend.bat
```

2. Start the frontend development server:
```bash
npm run dev
# or
yarn dev
```

3. Open your browser and navigate to `http://localhost:3000`

## Development

### Project Structure
```
Frank/
├── backend/
│   └── src/
│       └── main.py
├── public/
│   └── audioProcessor.js
├── src/
│   ├── app/
│   └── components/
├── .gitignore
├── README.md
├── package.json
└── requirements.txt
```

### Key Components

- `backend/src/main.py`: FastAPI server with WebSocket handling and AI model integration
- `public/audioProcessor.js`: Audio processing worklet for real-time audio handling
- `src/components/VoiceAssistant.tsx`: Main frontend component with UI and WebSocket logic

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Facebook AI Research for the MMS-1B model
- ElevenLabs for text-to-speech capabilities
- The FastAPI and Next.js communities
