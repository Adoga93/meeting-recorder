"use client";

import React, { useState, useEffect } from "react";
import { 
  Video, 
  Calendar, 
  Settings, 
  Play, 
  Download, 
  Clock, 
  User, 
  Plus, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  CloudLightning,
  Search,
  Cloud,
  ExternalLink,
  UploadCloud
} from "lucide-react";

export default function Dashboard() {
  // --- STATE MANAGEMENT ---
  const [meetingUrl, setMeetingUrl] = useState("");
  const [botName, setBotName] = useState("AI Recorder (Emma)");
  const [platform, setPlatform] = useState("google_meet");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [uploadingFile, setUploadingFile] = useState(null);
  const [isUploadingAll, setIsUploadingAll] = useState(false);

  // Live active recordings state
  const [activeRecordings, setActiveRecordings] = useState([]);

  // Calendar Sync List
  const [calendarEvents, setCalendarEvents] = useState([
    {
      id: "cal-1",
      title: "Product Roadmap Review",
      time: "Today, 2:00 PM - 2:45 PM",
      platform: "zoom",
      url: "https://zoom.us/j/987654321",
      autoRecord: true,
    },
    {
      id: "cal-2",
      title: "Client Onboarding: Tech Stack",
      time: "Tomorrow, 10:00 AM - 11:00 AM",
      platform: "google_meet",
      url: "https://meet.google.com/abc-def-ghi",
      autoRecord: false,
    }
  ]);

  // Past Recordings Library
  const [recordings, setRecordings] = useState([]);

  // --- AUTO-DETECT PLATFORM FROM URL ---
  useEffect(() => {
    if (meetingUrl.includes("meet.google.com")) {
      setPlatform("google_meet");
    } else if (meetingUrl.includes("zoom.us") || meetingUrl.includes("zoom.com")) {
      setPlatform("zoom");
    } else if (meetingUrl.includes("teams.live") || meetingUrl.includes("teams.microsoft")) {
      setPlatform("teams");
    }
  }, [meetingUrl]);

  // --- FETCH PAST RECORDINGS FROM BACKEND ---
  const fetchRecordings = async () => {
    try {
      const response = await fetch('/api/recordings');
      const data = await response.json();
      if (data.recordings) {
        setRecordings(data.recordings);
      }
    } catch (err) {
      console.error("Failed fetching recordings:", err);
    }
  };

  useEffect(() => {
    fetchRecordings();
    // Poll for new recordings every 10 seconds
    const interval = setInterval(fetchRecordings, 10000);
    return () => clearInterval(interval);
  }, []);

  // --- GOOGLE DRIVE UPLOAD HANDLERS ---
  const handleUploadToDrive = async (fileName) => {
    try {
      setUploadingFile(fileName);
      setErrorMessage("");
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMessage(`Successfully uploaded ${fileName} to Google Drive!`);
        await fetchRecordings();
      } else {
        setErrorMessage(data.error || "Failed to upload to Google Drive");
      }
    } catch (err) {
      setErrorMessage("Upload error: " + err.message);
    } finally {
      setUploadingFile(null);
    }
  };

  const handleUploadAllToDrive = async () => {
    try {
      setIsUploadingAll(true);
      setErrorMessage("");
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMessage("All pending recordings uploaded to Google Drive!");
        await fetchRecordings();
      } else {
        setErrorMessage(data.error || "Failed to upload recordings to Google Drive");
      }
    } catch (err) {
      setErrorMessage("Upload error: " + err.message);
    } finally {
      setIsUploadingAll(false);
    }
  };

  // --- SUBMIT: TRIGGER BOT ---
  const handleStartRecording = async (e) => {
    e.preventDefault();
    if (!meetingUrl) return;

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch('/api/record', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ meetingUrl, botName }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const newActive = {
          id: `active-${Date.now()}`,
          title: `Active Recording (${platform === 'google_meet' ? 'Meet' : platform === 'zoom' ? 'Zoom' : 'Teams'})`,
          url: meetingUrl,
          platform: platform,
          botName: botName,
          startedAt: new Date().toISOString(),
          status: "recording"
        };

        setActiveRecordings(prev => [newActive, ...prev]);
        setSuccessMessage("Meeting Recorder container started in background!");
        setMeetingUrl("");
      } else {
        setErrorMessage(data.error || "Failed to trigger the bot.");
      }
    } catch (err) {
      setErrorMessage("Could not connect to the backend server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle Auto-Record
  const toggleAutoRecord = (id) => {
    setCalendarEvents(prev =>
      prev.map(evt => evt.id === id ? { ...evt, autoRecord: !evt.autoRecord } : evt)
    );
  };

  // Filter Past Recordings
  const filteredRecordings = recordings.filter(rec => 
    rec.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#030306] text-[#fafafa] font-sans selection:bg-indigo-500/30 overflow-x-hidden relative">
      
      {/* Dynamic Ambient Background Highlights */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none -z-10" />
      <div className="absolute top-1/3 right-1/4 w-[400px] h-[400px] bg-cyan-600/5 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        
        {/* --- HEADER --- */}
        <header className="flex items-center justify-between border-b border-white/5 pb-6 mb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <Video className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
                OmniRecord AI
              </h1>
              <p className="text-xs text-zinc-500 font-medium">Multi-Platform Meeting Intelligence</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-xs text-zinc-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Cloud Engine Connected
            </div>
          </div>
        </header>

        {/* --- MAIN GRID --- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* LEFT COLUMN: Launch & Automate */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* CARD 1: INSTANT RECORDER LAUNCHER */}
            <div className="glass-panel rounded-2xl p-6 glow-indigo relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-24 h-24 bg-indigo-600/10 rounded-full blur-2xl" />
              
              <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
                <CloudLightning className="w-4 h-4 text-indigo-400" />
                Launch Instant Recorder
              </h2>
              <p className="text-sm text-zinc-400 mb-6">
                Paste your meeting link, and our bot will join and record it instantly.
              </p>

              {/* Success / Error feedbacks */}
              {successMessage && (
                <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  {successMessage}
                </div>
              )}
              {errorMessage && (
                <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {errorMessage}
                </div>
              )}

              <form onSubmit={handleStartRecording} className="space-y-4">
                
                {/* Meeting URL Input */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                    Meeting Room Link
                  </label>
                  <input
                    type="url"
                    value={meetingUrl}
                    onChange={(e) => setMeetingUrl(e.target.value)}
                    placeholder="https://meet.google.com/... or https://zoom.us/j/..."
                    className="w-full px-4 py-3 bg-[#0a0a0f] border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all font-mono text-sm"
                    required
                  />
                </div>

                {/* Grid for Name & Platform detection */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Bot Identifier */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                      Bot Display Identifier
                    </label>
                    <input
                      type="text"
                      value={botName}
                      onChange={(e) => setBotName(e.target.value)}
                      placeholder="e.g. AI Assistant"
                      className="w-full px-4 py-3 bg-[#0a0a0f] border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500 transition-all text-sm"
                    />
                  </div>

                  {/* Detected Platform */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                      Target Meeting Platform
                    </label>
                    <select
                      value={platform}
                      onChange={(e) => setPlatform(e.target.value)}
                      className="w-full px-4 py-3 bg-[#0a0a0f] border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500 transition-all text-sm"
                    >
                      <option value="google_meet">Google Meet</option>
                      <option value="zoom">Zoom Video</option>
                      <option value="teams">Microsoft Teams</option>
                    </select>
                  </div>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-medium rounded-xl shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/30 transition-all disabled:opacity-50 cursor-pointer text-sm"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Provisioning Secure Container...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Connect & Record Meeting
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* CARD 2: LIVE ACTIVE SESSIONS */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                Live Active Sessions ({activeRecordings.length})
              </h3>

              {activeRecordings.length === 0 ? (
                <div className="glass-panel rounded-2xl p-8 text-center text-zinc-500 border border-white/5">
                  No active recordings currently running.
                </div>
              ) : (
                <div className="space-y-3">
                  {activeRecordings.map((rec) => (
                    <div key={rec.id} className="glass-panel rounded-xl p-5 border border-white/5 hover:border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all relative overflow-hidden">
                      <div className="absolute top-0 left-0 bottom-0 w-1 bg-indigo-500" />
                      
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10">
                          <Video className="w-5 h-5 text-indigo-400" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-white text-sm">{rec.title}</h4>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400 mt-1">
                            <span className="font-mono text-indigo-300">{rec.url}</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <User className="w-3.5 h-3.5 text-zinc-500" />
                              {rec.botName}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 border-white/5 pt-3 md:pt-0">
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                            Live Recording
                          </span>
                        </div>

                        <button 
                          onClick={() => {
                            setActiveRecordings(prev => prev.filter(r => r.id !== rec.id));
                            setTimeout(fetchRecordings, 1500); // refresh list
                          }}
                          className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 hover:text-white rounded-lg text-xs font-semibold transition-all cursor-pointer"
                        >
                          Disconnect Bot
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CARD 3: PAST RECORDINGS GALLERY */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                    Recordings Library ({recordings.length})
                  </h3>
                  <button
                    onClick={handleUploadAllToDrive}
                    disabled={isUploadingAll}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isUploadingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3" />}
                    Sync All to Drive
                  </button>
                </div>
                
                {/* Search field */}
                <div className="relative max-w-xs w-full">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search past sessions..."
                    className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/5 rounded-xl text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-white/10 text-xs transition-all"
                  />
                </div>
              </div>

              {recordings.length === 0 ? (
                <div className="glass-panel rounded-2xl p-12 text-center text-zinc-500 border border-white/5">
                  No video files found inside the recordings folder.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredRecordings.map((rec) => (
                    <div key={rec.id} className="glass-panel rounded-xl p-5 border border-white/5 flex flex-col justify-between h-52 hover:translate-y-[-2px] transition-all">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] uppercase font-bold px-2 py-1 rounded bg-white/5 border border-white/5 text-zinc-400 tracking-wider">
                            {rec.platform === "google_meet" ? "Google Meet" : "Zoom Video"}
                          </span>
                          <span className="text-xs text-zinc-500 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {rec.duration}
                          </span>
                        </div>
                        
                        <h4 className="font-semibold text-white text-sm line-clamp-2 hover:text-indigo-400 transition-colors mb-2">
                          {rec.title}
                        </h4>
                        <p className="text-xs text-zinc-500">{rec.time}</p>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-white/5 mt-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-zinc-400 font-medium">
                            {rec.fileSize}
                          </span>

                          {rec.drive ? (
                            <a
                              href={rec.drive.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/20 transition-all font-medium"
                              title="Stored on Google Drive"
                            >
                              <Cloud className="w-3 h-3" />
                              Drive
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          ) : (
                            <button
                              onClick={() => handleUploadToDrive(rec.fileName)}
                              disabled={uploadingFile === rec.fileName}
                              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/5 transition-all cursor-pointer disabled:opacity-50"
                              title="Upload to Google Drive"
                            >
                              {uploadingFile === rec.fileName ? (
                                <Loader2 className="w-2.5 h-2.5 animate-spin text-indigo-400" />
                              ) : (
                                <Cloud className="w-2.5 h-2.5" />
                              )}
                              Upload
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button className="p-1.5 rounded bg-white/5 hover:bg-indigo-600 hover:text-white border border-white/5 text-zinc-300 transition-all cursor-pointer">
                            <Play className="w-3.5 h-3.5" />
                          </button>
                          <button className="p-1.5 rounded bg-white/5 hover:bg-indigo-600 hover:text-white border border-white/5 text-zinc-300 transition-all cursor-pointer">
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* RIGHT COLUMN: Calendar Automation */}
          <div className="space-y-6">
            
            {/* CARD: GOOGLE CALENDAR SYNC PANEL */}
            <div className="glass-panel rounded-2xl p-6 glow-cyan">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-cyan-400" />
                  Calendar Automation
                </h3>
                <span className="text-[10px] text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20 font-semibold uppercase tracking-wider">
                  Sync Active
                </span>
              </div>

              <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                Connect your work calendars. We will automatically deploy the bot recorder to join scheduled calls exactly when they begin.
              </p>

              <div className="space-y-4">
                {calendarEvents.map((event) => (
                  <div key={event.id} className="p-4 bg-black/40 border border-white/5 rounded-xl space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h4 className="text-sm font-semibold text-white hover:text-indigo-400 transition-colors line-clamp-1">
                          {event.title}
                        </h4>
                        <p className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {event.time}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                        {event.platform}
                      </span>
                    </div>

                    <div className="flex items-center justify-between border-t border-white/5 pt-2.5 mt-2">
                      <span className="text-xs text-zinc-400">Auto-record meeting</span>
                      <button
                        onClick={() => toggleAutoRecord(event.id)}
                        className={`w-9 h-5 rounded-full p-0.5 transition-all relative ${
                          event.autoRecord ? "bg-cyan-500" : "bg-zinc-800"
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white transition-all shadow-md transform ${
                            event.autoRecord ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>

        {/* --- FOOTER --- */}
        <footer className="text-center text-xs text-zinc-600 mt-16 pt-8 border-t border-white/5">
          <p>© 2026 OmniRecord AI. All rights reserved. Self-hosted cloud infrastructure active.</p>
        </footer>

      </div>
    </div>
  );
}
