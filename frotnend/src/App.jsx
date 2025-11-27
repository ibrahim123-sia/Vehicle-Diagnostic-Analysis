import React, { useState, useRef } from 'react';
import axios from 'axios';

const VideoProblemDetector = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [analysis, setAnalysis] = useState(null);
  
  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const videoPreviewRef = useRef(null);
  const timerRef = useRef(null);

  // Use environment variable for API URL
  const API_BASE_URL = import.meta.env.VITE_SERVER_URL || 'https://vehicle-diagnostic-analysis.vercel.app';

  // Start live recording
  const startRecording = async () => {
    try {
      setMessage('Initializing camera and microphone...');
      
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm; codecs=vp9,opus'
      });
      mediaRecorderRef.current = mediaRecorder;
      const chunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        setRecordedBlob(blob);
        setMessage('Recording complete. Ready for analysis.');
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      setMessage('Recording in progress... Please describe the vehicle issue clearly.');
      setRecordingTime(0);
      
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Error starting recording:', error);
      let errorMessage = 'Error accessing camera or microphone';
      
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Camera and microphone access denied. Please allow permissions.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'No camera found on this device.';
      } else if (error.name === 'NotSupportedError') {
        errorMessage = 'Your browser does not support video recording.';
      }
      
      setMessage(errorMessage);
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = null;
      }
    }
  };

  // Format time for display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Process recorded video
  const processRecording = async () => {
    if (!recordedBlob) {
      setMessage('Please record a video first');
      return;
    }

    setIsProcessing(true);
    setMessage('AI analysis in progress...');
    setAnalysis(null);

    const formData = new FormData();
    formData.append('recording', recordedBlob, `vehicle-recording-${Date.now()}.webm`);

    try {
      // Use the environment variable for API URL
      const response = await axios.post(`${API_BASE_URL}/process-recording`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 30000,
      });

      setMessage('Analysis complete');
      setAnalysis(response.data.analysis);
      
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message;
      setMessage(`Analysis failed: ${errorMsg}`);
      console.error('Analysis Error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Reset and start new recording
  const startNewRecording = () => {
    setRecordedBlob(null);
    setAnalysis(null);
    setMessage('');
    setRecordingTime(0);
  };

  // Severity color coding
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'bg-red-50 border-red-200 text-red-800';
      case 'medium': return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'low': return 'bg-green-50 border-green-200 text-green-800';
      default: return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  // Problem type icons using SVG or CSS
  const getProblemIcon = (type) => {
    return (
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
        type === 'brake' ? 'bg-red-100 text-red-600' :
        type === 'tire' ? 'bg-blue-100 text-blue-600' :
        type === 'engine' ? 'bg-orange-100 text-orange-600' :
        type === 'electrical' ? 'bg-purple-100 text-purple-600' :
        'bg-gray-100 text-gray-600'
      }`}>
        <span className="text-sm font-bold">
          {type === 'brake' ? 'B' : type === 'tire' ? 'T' : type === 'engine' ? 'E' : type === 'electrical' ? 'C' : 'V'}
        </span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 py-4 px-3">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Vehicle Diagnostic Analysis
          </h1>
          <p className="text-gray-600">
            Record vehicle issues for AI-powered diagnostic analysis
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Recording Section */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              Video Recording
            </h2>

            {/* Video Preview */}
            <div className="mb-4 rounded-lg overflow-hidden bg-gray-900 aspect-video">
              <video
                ref={videoPreviewRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              {!isRecording && !recordedBlob && (
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm">Camera preview will appear here</p>
                  </div>
                </div>
              )}
            </div>

            {/* Recording Timer */}
            {isRecording && (
              <div className="text-center mb-4">
                <div className="inline-flex items-center px-4 py-2 bg-red-50 text-red-700 rounded-full border border-red-200">
                  <span className="w-2 h-2 bg-red-500 rounded-full mr-2 animate-pulse"></span>
                  Recording: {formatTime(recordingTime)}
                </div>
              </div>
            )}

            {/* Recording Controls */}
            <div className="space-y-3">
              {!recordedBlob ? (
                <>
                  <button 
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`w-full py-3 px-4 rounded-lg font-semibold text-white transition-colors ${
                      isRecording 
                        ? 'bg-red-600 hover:bg-red-700' 
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {isRecording ? (
                      <span className="flex items-center justify-center">
                        <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="6" y="6" width="12" height="12" rx="1"/>
                        </svg>
                        Stop Recording
                      </span>
                    ) : (
                      <span className="flex items-center justify-center">
                        <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="5" fill="currentColor"/>
                        </svg>
                        Start Recording
                      </span>
                    )}
                  </button>

                  {isRecording && (
                    <div className="text-center text-sm text-gray-600 bg-blue-50 p-3 rounded-lg border border-blue-100">
                      <p className="font-medium">Recording Guidelines</p>
                      <p className="text-xs mt-1">Speak clearly and describe the vehicle issue in detail. Show affected components when possible.</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <button 
                    onClick={processRecording}
                    disabled={isProcessing}
                    className={`w-full py-3 px-4 rounded-lg font-semibold text-white transition-colors ${
                      isProcessing
                        ? 'bg-gray-400 cursor-not-allowed' 
                        : 'bg-green-600 hover:bg-green-700'
                    }`}
                  >
                    {isProcessing ? (
                      <span className="flex items-center justify-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                        Analyzing...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center">
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Analyze Recording
                      </span>
                    )}
                  </button>

                  <button 
                    onClick={startNewRecording}
                    className="w-full py-2 px-4 rounded-lg font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-300 transition-colors"
                  >
                    New Recording
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Results Section */}
          <div className="space-y-6">
            {/* Status Message */}
            {message && (
              <div className={`p-4 rounded-lg border ${
                message.includes('failed') || message.includes('denied') || message.includes('Error')
                  ? 'bg-red-50 border-red-200 text-red-800' 
                  : message.includes('Analyzing') || message.includes('Recording')
                  ? 'bg-blue-50 border-blue-200 text-blue-800'
                  : 'bg-green-50 border-green-200 text-green-800'
              }`}>
                <div className="font-medium">{message}</div>
              </div>
            )}

            {/* Analysis Results */}
            {analysis && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-semibold text-gray-800">
                    Diagnostic Report
                  </h2>
                  <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                    AI Analysis
                  </span>
                </div>

                {/* Keyword Matches - Enhanced Section */}
                {analysis.keywordSearch && (
                  <>
                    {/* When keywords are found in library */}
                    {analysis.keywordSearch.foundKeywords && analysis.keywordSearch.foundKeywords.length > 0 ? (
                      <div className="mb-6 p-4 bg-green-50 rounded-lg border border-green-200">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                            <svg className="w-5 h-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Issues Found in Knowledge Base
                          </h3>
                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">
                            {analysis.keywordSearch.totalKeywordsFound || analysis.keywordSearch.foundKeywords.length} matches
                          </span>
                        </div>
                        
                        <div className="mb-3">
                          <p className="text-sm text-green-700 mb-2">
                            These issues were identified from our vehicle problem database of {analysis.keywordSearch.librarySize || '100+'} known issues:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {analysis.keywordSearch.foundKeywords.map((keyword, index) => (
                              <span 
                                key={index} 
                                className="px-3 py-2 bg-white text-green-700 rounded-lg border border-green-200 text-sm font-medium shadow-sm flex items-center"
                              >
                                <svg className="w-3 h-3 mr-2 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                {keyword}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Categories Found */}
                        {analysis.keywordSearch.categories && analysis.keywordSearch.categories.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-green-200">
                            <p className="text-sm text-green-700 mb-2 font-medium">Problem categories detected:</p>
                            <div className="flex flex-wrap gap-2">
                              {analysis.keywordSearch.categories.map((category, index) => (
                                <span key={index} className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium capitalize">
                                  {category} issues
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* When NO keywords are found in library */
                      <div className="mb-6 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                        <div className="flex items-center mb-3">
                          <svg className="w-5 h-5 text-yellow-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <h3 className="text-lg font-semibold text-gray-800">No Exact Matches in Knowledge Base</h3>
                        </div>
                        <div className="text-sm text-yellow-700 space-y-2">
                          <p>
                            <strong>No specific issues were found in our vehicle problem database.</strong> This could mean:
                          </p>
                          <ul className="list-disc list-inside space-y-1 ml-2">
                            <li>Your issue description uses different terminology</li>
                            <li>This might be a rare or complex vehicle problem</li>
                            <li>The issue requires specialized diagnostic equipment</li>
                          </ul>
                          <p className="mt-2">
                            The AI analysis below is based on general understanding of your description rather than exact database matches.
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Problem Overview */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div className="p-4 rounded-lg border-2 border-blue-200 bg-blue-50">
                    <h3 className="text-sm font-medium text-gray-600 mb-2">Primary Issue</h3>
                    <p className="text-gray-700 font-medium">{analysis.mainProblem}</p>
                  </div>
                  <div className="p-4 rounded-lg border-2 border-purple-200 bg-purple-50">
                    <h3 className="text-sm font-medium text-gray-600 mb-2">Problem Type</h3>
                    <div className="flex items-center">
                      {getProblemIcon(analysis.problemType)}
                      <span className="ml-3 text-gray-700 font-medium capitalize">{analysis.problemType} Problem</span>
                    </div>
                  </div>
                </div>

                {/* Severity Indicator */}
                {analysis.severity && (
                  <div className="mb-6 p-4 rounded-lg border-2 bg-white">
                    <h3 className="text-sm font-medium text-gray-600 mb-2">Severity Level</h3>
                    <div className={`inline-flex items-center px-4 py-2 rounded-full font-medium ${
                      analysis.severity === 'high' 
                        ? 'bg-red-100 text-red-800 border border-red-200' 
                        : analysis.severity === 'medium'
                        ? 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                        : 'bg-green-100 text-green-800 border border-green-200'
                    }`}>
                      <span className={`w-2 h-2 rounded-full mr-2 ${
                        analysis.severity === 'high' ? 'bg-red-500' :
                        analysis.severity === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                      }`}></span>
                      {analysis.severity.toUpperCase()} Severity
                    </div>
                  </div>
                )}

                {/* Specific Issues */}
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">
                    Identified Problems
                  </h3>
                  <div className="space-y-2">
                    {analysis.specificIssues && analysis.specificIssues.map((issue, index) => (
                      <div key={index} className="p-3 bg-red-50 rounded border border-red-100">
                        <span className="text-red-700 text-sm">{issue}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recommendation */}
                <div className="mb-6 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">
                    Recommended Action
                  </h3>
                  <p className="text-gray-700 text-sm">{analysis.recommendation}</p>
                </div>

                {/* Technical Terms */}
                {analysis.keywords && analysis.keywords.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-3">
                      Technical Terms Identified
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {analysis.keywords.map((keyword, index) => (
                        <span key={index} className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-sm border">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Transcription */}
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">
                    Transcript
                  </h3>
                  <div className="bg-gray-50 p-4 rounded border border-gray-200 max-h-40 overflow-y-auto">
                    <p className="text-sm text-gray-700 leading-relaxed">{analysis.transcription}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Tips Section */}
            {!analysis && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                  Recording Guidelines
                </h3>
                <ul className="text-sm text-gray-600 space-y-3">
                  <li className="flex items-start">
                    <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Speak clearly and describe the vehicle problem in detail</span>
                  </li>
                  <li className="flex items-start">
                    <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Show the specific vehicle component when possible</span>
                  </li>
                  <li className="flex items-start">
                    <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Record in a quiet environment for better audio quality</span>
                  </li>
                  <li className="flex items-start">
                    <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Optimal recording length: 30-120 seconds</span>
                  </li>
                  <li className="flex items-start">
                    <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Use common vehicle terminology for better database matching</span>
                  </li>
                </ul>

                <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
                  <h4 className="text-sm font-medium text-blue-800 mb-1">About Our Knowledge Base</h4>
                  <p className="text-xs text-blue-700">
                    We match your description against a database of 100+ common vehicle issues including brake, engine, tire, electrical, and transmission problems.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoProblemDetector;