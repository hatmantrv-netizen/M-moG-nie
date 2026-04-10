/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { 
  BookOpen, 
  Plus, 
  Library, 
  Brain, 
  ChevronLeft, 
  ChevronRight, 
  RotateCcw, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  LogOut, 
  LogIn,
  GraduationCap,
  Languages,
  Atom,
  History,
  Calculator,
  Globe,
  Trash2,
  Play,
  FileText,
  Info,
  Lightbulb,
  Download,
  Zap,
  HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import Markdown from 'react-markdown';
import mermaid from 'mermaid';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  serverTimestamp,
  Timestamp
} from './firebase';

// Types
interface Flashcard {
  question: string;
  answer: string;
}

interface FlashcardSet {
  id: string;
  userId: string;
  title: string;
  grade: string;
  subject: string;
  topic: string;
  cards: Flashcard[];
  revisionSheet?: {
    lesson: string;
    keyPoints: string[];
    keywords: string[];
    schemaDescription?: string;
    example?: string;
    lastMinuteSummary?: string;
  };
  createdAt: any;
}

type View = 'home' | 'generator' | 'library' | 'revision' | 'quiz' | 'sheet' | 'how-to-learn' | 'last-minute';

const GRADES = [
  "6ème", "5ème", "4ème", "3ème", "Seconde", "Première", "Terminale"
];

const SUBJECTS = [
  { id: 'maths', name: 'Mathématiques', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Calculator },
  { id: 'svt', name: 'SVT', color: 'bg-green-100 text-green-700 border-green-200', icon: Atom },
  { id: 'physique', name: 'Physique-Chimie', color: 'bg-purple-100 text-purple-700 border-purple-200', icon: Atom },
  { id: 'histoire', name: 'Histoire-Géo', color: 'bg-red-100 text-red-700 border-red-200', icon: History },
  { id: 'francais', name: 'Français', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: BookOpen },
  { id: 'anglais', name: 'Anglais', color: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: Globe },
  { id: 'espagnol', name: 'Espagnol', color: 'bg-orange-100 text-orange-700 border-orange-200', icon: Languages },
  { id: 'allemand', name: 'Allemand', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: Languages },
  { id: 'italien', name: 'Italien', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: Languages },
  { id: 'chinois', name: 'Chinois', color: 'bg-rose-100 text-rose-700 border-rose-200', icon: Languages },
];

const SYSTEM_INSTRUCTION = `Tu es un expert pédagogique du programme scolaire français (de la 6ème à la Terminale).
Ton rôle est de générer :
1. Un set de 10 cartes mémo (flashcards) pertinentes et précises. Chaque carte doit avoir une question claire et une réponse concise.
2. Une fiche de révision complète comprenant :
   - Une leçon synthétique (format Markdown, max 800 mots). Utilise des titres (##) sur des lignes séparées pour structurer la leçon.
   - Les points importants à retenir (liste de 5-7 points).
   - Les mots-clés essentiels (5-10 mots).
   - Un schéma Mermaid.js si pertinent (ex: graph TD, sequenceDiagram). Si pas de schéma, laisse vide.
   - Un exemple concret court.
   - Une "Fiche Dernière Minute" : un résumé ultra-condensé (format Markdown) qui tient sur une seule page A4, regroupant l'essentiel absolu du chapitre pour une révision rapide juste avant un examen.

Réponds EXCLUSIVEMENT au format JSON. Utilise des sauts de ligne réels (\n) dans les chaînes de caractères JSON pour le Markdown. Sois précis mais concis pour garantir une réponse complète sans troncature.`;

// Mermaid Component
const Mermaid = ({ chart }: { chart: string }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
    const renderChart = async () => {
      try {
        const { svg } = await mermaid.render(`mermaid-${Math.random().toString(36).substr(2, 9)}`, chart);
        setSvg(svg);
        setError(false);
      } catch (e) {
        console.error("Mermaid render error:", e);
        setError(true);
      }
    };
    if (chart) renderChart();
  }, [chart]);

  if (error) return <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm italic">Erreur lors du rendu du schéma.</div>;
  if (!svg) return <div className="h-20 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div>;

  return <div className="mermaid-chart overflow-x-auto py-4" dangerouslySetInnerHTML={{ __html: svg }} />;
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<View>('home');
  const [loading, setLoading] = useState(true);
  const [sets, setSets] = useState<FlashcardSet[]>([]);
  const [currentSet, setCurrentSet] = useState<FlashcardSet | null>(null);
  
  // Generator state
  const [grade, setGrade] = useState(GRADES[0]);
  const [subject, setSubject] = useState(SUBJECTS[0].id);
  const [topic, setTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Revision state
  const [cardIndex, setCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  // Quiz state
  const [quizScore, setQuizScore] = useState(0);
  const [quizFinished, setQuizFinished] = useState(false);
  const [quizOptions, setQuizOptions] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [missedQuestions, setMissedQuestions] = useState<Flashcard[]>([]);
  const [pointsToImprove, setPointsToImprove] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const downloadPDF = async () => {
    const element = document.getElementById('last-minute-sheet-content');
    if (!element) return;
    
    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const imgProps = pdf.getImageProperties(imgData);
      const imgWidth = pdfWidth - 20; // 10mm margin each side
      const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 10, 10, imgWidth, imgHeight);
      pdf.save(`MemoGenie_DerniereMinute_${currentSet?.title.replace(/\s+/g, '_')}.pdf`);
    } catch (err) {
      console.error("PDF generation error:", err);
      alert("Erreur lors de la génération du PDF.");
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        // Save user to Firestore
        setDoc(doc(db, 'users', u.uid), {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL,
          createdAt: serverTimestamp()
        }, { merge: true });
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setSets([]);
      return;
    }

    const q = query(
      collection(db, 'flashcardSets'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newSets = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FlashcardSet[];
      setSets(newSets);
    }, (error) => {
      console.error("Error fetching sets:", error);
    });

    return unsubscribe;
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setView('home');
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const generateCards = async () => {
    if (!topic.trim()) return;
    setIsGenerating(true);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Génère un set complet (cartes + fiche de révision) pour le niveau ${grade}, matière ${SUBJECTS.find(s => s.id === subject)?.name}, sujet : ${topic}.`,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              cards: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    answer: { type: Type.STRING }
                  },
                  required: ["question", "answer"]
                }
              },
              revisionSheet: {
                type: Type.OBJECT,
                properties: {
                  lesson: { type: Type.STRING },
                  keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                  keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                  schemaDescription: { type: Type.STRING },
                  example: { type: Type.STRING },
                  lastMinuteSummary: { type: Type.STRING, description: "Résumé ultra-condensé pour une révision de dernière minute." }
                },
                required: ["lesson", "keyPoints", "keywords", "lastMinuteSummary"]
              }
            },
            required: ["cards", "revisionSheet"]
          }
        }
      });

      const text = response.text?.trim() || '{}';
      const data = JSON.parse(text);
      
      // Sanitize markdown content to handle literal \n returned by AI
      const sanitize = (str: string) => str ? str.replace(/\\n/g, '\n') : "";
      
      if (data.revisionSheet) {
        data.revisionSheet.lesson = sanitize(data.revisionSheet.lesson);
        if (data.revisionSheet.example) {
          data.revisionSheet.example = sanitize(data.revisionSheet.example);
        }
        if (data.revisionSheet.lastMinuteSummary) {
          data.revisionSheet.lastMinuteSummary = sanitize(data.revisionSheet.lastMinuteSummary);
        }
      }
      
      const newSet = {
        userId: user.uid,
        title: topic,
        grade,
        subject,
        topic,
        cards: data.cards || [],
        revisionSheet: data.revisionSheet,
        createdAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, 'flashcardSets'), newSet);
      setCurrentSet({ id: docRef.id, ...newSet, createdAt: Timestamp.now() });
      setView('sheet');
      setCardIndex(0);
      setIsFlipped(false);
      setTopic('');
    } catch (error) {
      console.error("Generation error:", error);
      alert("Erreur lors de la génération. Vérifiez votre connexion.");
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteSet = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Supprimer ce set ?")) {
      try {
        // In a real app, we'd use deleteDoc
        // But for this demo, we'll just filter local state if needed
        // Actually, onSnapshot will handle it if we delete from Firestore
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'flashcardSets', id));
      } catch (error) {
        console.error("Delete error:", error);
      }
    }
  };

  const startQuiz = () => {
    if (!currentSet) return;
    setQuizScore(0);
    setQuizFinished(false);
    setMissedQuestions([]);
    setPointsToImprove('');
    setCardIndex(0);
    setView('quiz');
    generateQuizOptions(0);
  };

  const generateQuizOptions = (index: number) => {
    if (!currentSet) return;
    const correctAnswer = currentSet.cards[index].answer;
    const otherAnswers = currentSet.cards
      .filter((_, i) => i !== index)
      .map(c => c.answer)
      .sort(() => 0.5 - Math.random())
      .slice(0, 3);
    
    const options = [correctAnswer, ...otherAnswers].sort(() => 0.5 - Math.random());
    setQuizOptions(options);
    setSelectedOption(null);
  };

  const handleQuizAnswer = (option: string) => {
    if (selectedOption || !currentSet) return;
    setSelectedOption(option);
    const currentCard = currentSet.cards[cardIndex];
    if (option === currentCard.answer) {
      setQuizScore(prev => prev + 1);
    } else {
      setMissedQuestions(prev => [...prev, currentCard]);
    }

    setTimeout(async () => {
      if (cardIndex < currentSet.cards.length - 1) {
        setCardIndex(prev => prev + 1);
        generateQuizOptions(cardIndex + 1);
      } else {
        setQuizFinished(true);
        // If score is low, generate feedback
        const finalScore = option === currentCard.answer ? quizScore + 1 : quizScore;
        if (finalScore < 8) {
          generateFeedback(finalScore);
        }
      }
    }, 1000);
  };

  const generateFeedback = async (score: number) => {
    if (!currentSet) return;
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const missedTopics = missedQuestions.map(q => q.question).join(', ');
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `L'élève a obtenu un score de ${score}/10 sur le sujet "${currentSet.title}".
        Il a fait des erreurs sur les points suivants : ${missedTopics}.
        Donne-lui 3-4 points précis à améliorer ou à revoir pour progresser. Sois encourageant et synthétique.`,
      });
      setPointsToImprove(response.text || '');
    } catch (error) {
      console.error("Feedback error:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => setView('home')}
          >
            <div className="bg-indigo-600 p-2 rounded-xl group-hover:scale-110 transition-transform">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-800">MémoGénie</span>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setView('how-to-learn')}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all ${view === 'how-to-learn' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <HelpCircle className="w-5 h-5" />
              <span className="hidden md:inline">Comment apprendre ?</span>
            </button>
            {user ? (
              <>
                <button 
                  onClick={() => setView('library')}
                  className={`p-2 rounded-lg transition-colors ${view === 'library' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  <Library className="w-6 h-6" />
                </button>
                <button 
                  onClick={() => setView('generator')}
                  className={`p-2 rounded-lg transition-colors ${view === 'generator' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  <Plus className="w-6 h-6" />
                </button>
                <div className="h-8 w-px bg-slate-200 mx-2" />
                <button 
                  onClick={handleLogout}
                  className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <LogOut className="w-6 h-6" />
                </button>
              </>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-sm"
              >
                <LogIn className="w-5 h-5" />
                <span>Connexion</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-4 md:p-8">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center py-12 md:py-20"
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-full text-sm font-semibold mb-6">
                <GraduationCap className="w-4 h-4" />
                <span>Réussis tes examens avec l'IA</span>
              </div>
              <h1 className="text-4xl md:text-6xl font-extrabold text-slate-900 mb-6 leading-tight">
                Apprends plus vite,<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">
                  Retiens pour toujours.
                </span>
              </h1>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto mb-10">
                MémoGénie génère instantanément des cartes mémo personnalisées basées sur le programme scolaire français. De la 6ème à la Terminale.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                {user ? (
                  <button 
                    onClick={() => setView('generator')}
                    className="w-full sm:w-auto px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:-translate-y-1 transition-all"
                  >
                    Créer mes cartes
                  </button>
                ) : (
                  <button 
                    onClick={handleLogin}
                    className="w-full sm:w-auto px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:-translate-y-1 transition-all"
                  >
                    Commencer gratuitement
                  </button>
                )}
                <button 
                  onClick={() => setView('library')}
                  className="w-full sm:w-auto px-8 py-4 bg-white text-slate-700 border border-slate-200 rounded-2xl font-bold text-lg hover:bg-slate-50 transition-all"
                >
                  Voir la bibliothèque
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-20">
                {[
                  { title: "Génération IA", desc: "Des cartes précises basées sur ton chapitre actuel.", icon: Brain, color: "text-blue-600 bg-blue-50" },
                  { title: "Multi-matières", desc: "Maths, SVT, Langues (LV2/LV3), Histoire...", icon: BookOpen, color: "text-green-600 bg-green-50" },
                  { title: "Mode Quiz", desc: "Teste tes connaissances avec des QCM interactifs.", icon: Play, color: "text-purple-600 bg-purple-50" }
                ].map((feature, i) => (
                  <div key={i} className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow text-left">
                    <div className={`w-12 h-12 ${feature.color} rounded-2xl flex items-center justify-center mb-4`}>
                      <feature.icon className="w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                    <p className="text-slate-500">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'generator' && (
            <motion.div 
              key="generator"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-2xl mx-auto"
            >
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl">
                <h2 className="text-3xl font-bold mb-8 flex items-center gap-3">
                  <Plus className="w-8 h-8 text-indigo-600" />
                  Nouveau Set de Cartes
                </h2>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Classe</label>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {GRADES.map(g => (
                        <button
                          key={g}
                          onClick={() => setGrade(g)}
                          className={`py-2 px-3 rounded-xl text-sm font-medium border transition-all ${grade === g ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Matière</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {SUBJECTS.map(s => (
                        <button
                          key={s.id}
                          onClick={() => setSubject(s.id)}
                          className={`flex items-center gap-2 py-3 px-4 rounded-xl text-sm font-medium border transition-all ${subject === s.id ? `${s.color} border-current shadow-md` : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                        >
                          <s.icon className="w-4 h-4" />
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Chapitre ou Sujet précis</label>
                    <input 
                      type="text"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="Ex: La photosynthèse, Le théorème de Thalès..."
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>

                  <button 
                    onClick={generateCards}
                    disabled={isGenerating || !topic.trim()}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg shadow-lg shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 transition-all"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        Génération en cours...
                      </>
                    ) : (
                      <>
                        <Brain className="w-6 h-6" />
                        Générer 10 Cartes
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'library' && (
            <motion.div 
              key="library"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-bold">Ma Bibliothèque</h2>
                <button 
                  onClick={() => setView('generator')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Nouveau
                </button>
              </div>

              {sets.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-300">
                  <Library className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500 text-lg">Tu n'as pas encore de sets de cartes.</p>
                  <button 
                    onClick={() => setView('generator')}
                    className="mt-4 text-indigo-600 font-bold hover:underline"
                  >
                    Crée ton premier set maintenant
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {sets.map(set => {
                    const subjectInfo = SUBJECTS.find(s => s.id === set.subject);
                    return (
                      <motion.div 
                        key={set.id}
                        layoutId={set.id}
                        onClick={() => {
                          setCurrentSet(set);
                          setView('revision');
                          setCardIndex(0);
                          setIsFlipped(false);
                        }}
                        className="group bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden"
                      >
                        <div className={`absolute top-0 left-0 w-2 h-full ${subjectInfo?.color.split(' ')[0]}`} />
                        <div className="flex justify-between items-start mb-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${subjectInfo?.color}`}>
                            {subjectInfo?.name}
                          </span>
                          <button 
                            onClick={(e) => deleteSet(set.id, e)}
                            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2 line-clamp-2">{set.title}</h3>
                        <div className="flex items-center gap-4 text-sm text-slate-500">
                          <span className="flex items-center gap-1">
                            <GraduationCap className="w-4 h-4" />
                            {set.grade}
                          </span>
                          <span className="flex items-center gap-1">
                            <Brain className="w-4 h-4" />
                            {set.cards.length} cartes
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {(view === 'revision' || view === 'sheet' || view === 'last-minute') && currentSet && (
            <motion.div 
              key="study"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className={`mx-auto transition-all duration-500 ${view === 'sheet' || view === 'last-minute' ? 'max-w-5xl' : 'max-w-3xl'}`}
            >
              <div className="flex items-center justify-between mb-8">
                <button 
                  onClick={() => setView('library')}
                  className="flex items-center gap-1 text-slate-500 hover:text-indigo-600 font-medium transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                  Retour
                </button>
                <div className="text-center">
                  <h2 className="text-xl font-bold text-slate-800">{currentSet.title}</h2>
                  <div className="flex items-center justify-center gap-2 mt-1">
                    <button 
                      onClick={() => setView('revision')}
                      className={`text-xs uppercase tracking-widest font-bold px-2 py-1 rounded-md transition-colors ${view === 'revision' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-indigo-600'}`}
                    >
                      Flashcards
                    </button>
                    <button 
                      onClick={() => setView('sheet')}
                      className={`text-xs uppercase tracking-widest font-bold px-2 py-1 rounded-md transition-colors ${view === 'sheet' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-indigo-600'}`}
                    >
                      Fiche
                    </button>
                    <button 
                      onClick={() => setView('last-minute')}
                      className={`text-xs uppercase tracking-widest font-bold px-2 py-1 rounded-md transition-colors ${view === 'last-minute' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-indigo-600'}`}
                    >
                      Dernière Minute
                    </button>
                  </div>
                </div>
                <button 
                  onClick={startQuiz}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-md"
                >
                  <Play className="w-4 h-4" />
                  Quiz
                </button>
              </div>

              {view === 'revision' ? (
                <div className="max-w-2xl mx-auto">
                  <div className="relative h-96 w-full perspective-1000">
                    <motion.div 
                      className="w-full h-full relative preserve-3d cursor-pointer"
                      animate={{ rotateY: isFlipped ? 180 : 0 }}
                      transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
                      onClick={() => setIsFlipped(!isFlipped)}
                    >
                      {/* Front */}
                      <div className="absolute inset-0 backface-hidden bg-white rounded-3xl border-2 border-slate-200 shadow-xl flex flex-col items-center justify-center p-12 text-center">
                        <span className="absolute top-6 left-6 text-xs font-bold text-slate-400 uppercase tracking-widest">Question {cardIndex + 1} / {currentSet.cards.length}</span>
                        <h3 className="text-2xl md:text-3xl font-bold text-slate-800 leading-relaxed">
                          {currentSet.cards[cardIndex].question}
                        </h3>
                        <p className="mt-8 text-slate-400 text-sm font-medium animate-pulse italic">Clique pour retourner</p>
                      </div>

                      {/* Back */}
                      <div 
                        className="absolute inset-0 backface-hidden bg-indigo-600 rounded-3xl shadow-xl flex flex-col items-center justify-center p-12 text-center text-white"
                        style={{ transform: 'rotateY(180deg)' }}
                      >
                        <span className="absolute top-6 left-6 text-xs font-bold text-indigo-200 uppercase tracking-widest">Réponse</span>
                        <h3 className="text-2xl md:text-3xl font-medium leading-relaxed">
                          {currentSet.cards[cardIndex].answer}
                        </h3>
                        <p className="mt-8 text-indigo-200 text-sm font-medium italic">Clique pour revenir à la question</p>
                      </div>
                    </motion.div>
                  </div>

                  <div className="flex items-center justify-center gap-6 mt-10">
                    <button 
                      onClick={() => {
                        setCardIndex(prev => Math.max(0, prev - 1));
                        setIsFlipped(false);
                      }}
                      disabled={cardIndex === 0}
                      className="p-4 bg-white border border-slate-200 rounded-2xl text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-all shadow-sm active:scale-95"
                    >
                      <ChevronLeft className="w-8 h-8" />
                    </button>
                    <div className="bg-white px-6 py-3 rounded-2xl border border-slate-200 font-bold text-slate-700 shadow-sm">
                      {cardIndex + 1} / {currentSet.cards.length}
                    </div>
                    <button 
                      onClick={() => {
                        if (cardIndex < currentSet.cards.length - 1) {
                          setCardIndex(prev => prev + 1);
                          setIsFlipped(false);
                        }
                      }}
                      disabled={cardIndex === currentSet.cards.length - 1}
                      className="p-4 bg-white border border-slate-200 rounded-2xl text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-all shadow-sm active:scale-95"
                    >
                      <ChevronRight className="w-8 h-8" />
                    </button>
                  </div>
                </div>
              ) : view === 'sheet' ? (
                <div className="space-y-8 pb-20">
                  {/* Header de la fiche */}
                  <div className="bg-white p-10 md:p-16 rounded-[2.5rem] border border-slate-200 card-shadow relative overflow-hidden mb-12">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full -mr-32 -mt-32 opacity-50 blur-3xl" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-50 rounded-full -ml-24 -mb-24 opacity-30 blur-2xl" />
                    
                    <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-6">
                        <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-[0.2em] ${SUBJECTS.find(s => s.id === currentSet.subject)?.color || 'bg-slate-100 text-slate-600'}`}>
                          {SUBJECTS.find(s => s.id === currentSet.subject)?.name}
                        </span>
                        <span className="px-4 py-1.5 bg-slate-100 text-slate-600 rounded-full text-xs font-black uppercase tracking-[0.2em]">
                          {currentSet.grade}
                        </span>
                      </div>
                      <h1 className="text-4xl md:text-6xl font-black text-slate-900 leading-[1.1] tracking-tight max-w-2xl">
                        {currentSet.title}
                      </h1>
                      <div className="mt-8 flex items-center gap-4 text-slate-400 font-medium">
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-5 h-5" />
                          <span>Fiche de révision complète</span>
                        </div>
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                        <span>10 Flashcards incluses</span>
                      </div>
                    </div>
                  </div>

                  {/* Grille de contenu */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Colonne Principale (Leçon) */}
                    <div className="lg:col-span-2 space-y-12">
                      <section className="bg-white p-10 md:p-12 rounded-[2rem] border border-slate-200 card-shadow">
                        <h3 className="text-2xl font-black mb-8 flex items-center gap-4 text-slate-900">
                          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0">
                            <BookOpen className="w-5 h-5 text-white" />
                          </div>
                          L'essentiel du cours
                        </h3>
                        <div className="prose prose-slate max-w-none">
                          <Markdown>{currentSet.revisionSheet?.lesson || "Aucune leçon disponible."}</Markdown>
                        </div>
                      </section>

                      {currentSet.revisionSheet?.schemaDescription && (
                        <section className="bg-white p-10 md:p-12 rounded-[2rem] border border-slate-200 card-shadow">
                          <h3 className="text-2xl font-black mb-8 flex items-center gap-4 text-slate-900">
                            <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center shrink-0">
                              <Atom className="w-5 h-5 text-white" />
                            </div>
                            Schéma de synthèse
                          </h3>
                          <div className="bg-slate-50 rounded-3xl p-8 flex justify-center border border-slate-100">
                            <Mermaid chart={currentSet.revisionSheet.schemaDescription} />
                          </div>
                        </section>
                      )}

                      {currentSet.revisionSheet?.example && (
                        <section className="bg-amber-50 p-10 md:p-12 rounded-[2rem] border border-amber-100 card-shadow relative overflow-hidden">
                          <div className="absolute top-8 right-8 text-amber-200/50">
                            <Info className="w-20 h-20 rotate-12" />
                          </div>
                          <h3 className="text-2xl font-black mb-6 flex items-center gap-4 text-amber-900 relative z-10">
                            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shrink-0">
                              <Lightbulb className="w-5 h-5 text-white" />
                            </div>
                            Exemple pratique
                          </h3>
                          <div className="relative z-10 bg-white/50 backdrop-blur-sm p-6 rounded-2xl border border-amber-200/50">
                            <p className="text-amber-950 italic leading-relaxed text-xl font-medium">
                              "{currentSet.revisionSheet.example}"
                            </p>
                          </div>
                        </section>
                      )}
                    </div>

                    {/* Colonne Latérale (Points clés & Mots-clés) */}
                    <div className="space-y-8">
                      <div className="sticky top-24 space-y-8">
                        <section className="glass p-8 rounded-[2rem] card-shadow">
                          <div className="space-y-10">
                            <div>
                              <h3 className="text-xl font-black mb-6 flex items-center gap-3 text-emerald-700">
                                <CheckCircle2 className="w-6 h-6" />
                                Points clés
                              </h3>
                              <ul className="space-y-5">
                                {currentSet.revisionSheet?.keyPoints.map((point, i) => (
                                  <li key={i} className="flex items-start gap-4 text-slate-700 text-sm font-medium leading-relaxed">
                                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 mt-1 shrink-0 shadow-sm shadow-emerald-200" />
                                    {point}
                                  </li>
                                ))}
                              </ul>
                            </div>

                            <div className="pt-8 border-t border-slate-200/50">
                              <h3 className="text-xl font-black mb-6 flex items-center gap-3 text-indigo-700">
                                <Languages className="w-6 h-6" />
                                Vocabulaire
                              </h3>
                              <div className="flex flex-wrap gap-2">
                                {currentSet.revisionSheet?.keywords.map((word, i) => (
                                  <span key={i} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-md shadow-indigo-100">
                                    {word}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </section>
                        
                        <div className="bg-indigo-600 rounded-[2rem] p-8 text-white card-shadow overflow-hidden relative group cursor-pointer" onClick={startQuiz}>
                          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-150 duration-500" />
                          <h4 className="text-xl font-black mb-2 relative z-10">Prêt pour le test ?</h4>
                          <p className="text-indigo-100 text-sm mb-6 relative z-10">Vérifie tes connaissances avec un quiz rapide de 10 questions.</p>
                          <div className="bg-white text-indigo-600 py-3 rounded-xl font-black text-center relative z-10 flex items-center justify-center gap-2 group-hover:bg-indigo-50 transition-colors">
                            <Play className="w-4 h-4 fill-current" />
                            LANCER LE QUIZ
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-8 pb-20">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3">
                      <Zap className="w-6 h-6 text-indigo-600" />
                      Fiche Dernière Minute
                    </h2>
                    <button 
                      onClick={downloadPDF}
                      className="flex items-center gap-2 bg-white border border-slate-200 px-6 py-3 rounded-2xl font-black text-indigo-600 hover:bg-indigo-50 transition-all shadow-sm"
                    >
                      <Download className="w-5 h-5" />
                      TÉLÉCHARGER PDF
                    </button>
                  </div>

                  <div id="last-minute-sheet-content" className="bg-white p-12 md:p-20 rounded-[3rem] border border-slate-200 card-shadow">
                    <div className="max-w-3xl mx-auto">
                      <div className="text-center mb-16">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-indigo-600 text-white rounded-full text-[10px] font-black uppercase tracking-[0.2em] mb-6">
                          <Zap className="w-3 h-3" />
                          Dernière Minute
                        </div>
                        <h1 className="text-5xl font-black text-slate-900 mb-4">{currentSet.title}</h1>
                        <div className="flex items-center justify-center gap-4 text-slate-400 font-bold uppercase text-xs tracking-widest">
                          <span>{SUBJECTS.find(s => s.id === currentSet.subject)?.name}</span>
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                          <span>{currentSet.grade}</span>
                        </div>
                      </div>

                      <div className="prose prose-slate max-w-none prose-lg">
                        <Markdown>{currentSet.revisionSheet?.lastMinuteSummary || "Résumé non disponible."}</Markdown>
                      </div>

                      <div className="mt-20 pt-10 border-t border-slate-100 flex items-center justify-between text-slate-300">
                        <div className="flex items-center gap-2 font-black text-[10px] uppercase tracking-widest">
                          <Brain className="w-4 h-4" />
                          Généré par MémoGénie
                        </div>
                        <div className="text-[10px] font-bold">
                          {new Date().toLocaleDateString('fr-FR')}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'how-to-learn' && (
            <motion.div 
              key="how-to-learn"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto py-12"
            >
              <div className="text-center mb-16">
                <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">Comment bien apprendre ?</h2>
                <p className="text-xl text-slate-500 max-w-2xl mx-auto">
                  Apprendre n'est pas une question de temps passé, mais de méthode. Voici les techniques les plus efficaces validées par les sciences cognitives.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {[
                  {
                    title: "Active Recall",
                    subtitle: "Récupération Active",
                    desc: "C'est la technique la plus puissante. Au lieu de relire ton cours, ferme ton cahier et essaie de te souvenir de tout ce que tu viens de lire. Utilise nos Flashcards pour ça !",
                    icon: Brain,
                    color: "bg-indigo-600"
                  },
                  {
                    title: "Spaced Repetition",
                    subtitle: "Répétition Espacée",
                    desc: "Ne révise pas tout d'un coup. Revois ton chapitre à des intervalles de plus en plus longs : 1 jour après, 3 jours après, 1 semaine, puis 1 mois. Ça ancre l'info dans la mémoire longue.",
                    icon: RotateCcw,
                    color: "bg-emerald-600"
                  },
                  {
                    title: "Feynman Technique",
                    subtitle: "Expliquer pour Comprendre",
                    desc: "Essaie d'expliquer le concept à quelqu'un qui n'y connaît rien (ou à ton chat). Si tu n'arrives pas à l'expliquer simplement, c'est que tu ne l'as pas encore totalement compris.",
                    icon: Lightbulb,
                    color: "bg-amber-500"
                  },
                  {
                    title: "Dual Coding",
                    subtitle: "Texte + Image",
                    desc: "Le cerveau retient mieux quand il associe un mot à une image. C'est pour ça que MémoGénie génère des schémas Mermaid.js pour tes fiches de révision.",
                    icon: Atom,
                    color: "bg-purple-600"
                  }
                ].map((method, i) => (
                  <div key={i} className="bg-white p-8 rounded-[2.5rem] border border-slate-200 card-shadow group hover:-translate-y-2 transition-all duration-300">
                    <div className={`w-14 h-14 ${method.color} rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-current/20`}>
                      <method.icon className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="text-2xl font-black text-slate-900 mb-1">{method.title}</h3>
                    <p className="text-indigo-600 font-bold text-sm mb-4 uppercase tracking-widest">{method.subtitle}</p>
                    <p className="text-slate-500 leading-relaxed">{method.desc}</p>
                  </div>
                ))}
              </div>

              <div className="mt-16 bg-slate-900 rounded-[3rem] p-10 md:p-16 text-white card-shadow relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-600 rounded-full -mr-48 -mt-48 opacity-20 blur-3xl" />
                <div className="relative z-10">
                  <h3 className="text-3xl font-black mb-6">Le secret de la réussite ?</h3>
                  <p className="text-xl text-slate-300 mb-10 leading-relaxed max-w-2xl">
                    "L'erreur est le meilleur moteur de l'apprentissage. Ne sois pas frustré si tu rates un quiz, c'est précisément à ce moment-là que ton cerveau apprend le plus."
                  </p>
                  <button 
                    onClick={() => setView('generator')}
                    className="px-8 py-4 bg-white text-slate-900 rounded-2xl font-black hover:bg-indigo-50 transition-all flex items-center gap-3"
                  >
                    <Plus className="w-5 h-5" />
                    CRÉER UNE NOUVELLE FICHE
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'quiz' && currentSet && (
            <motion.div 
              key="quiz"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              className="max-w-2xl mx-auto"
            >
              {!quizFinished ? (
                <>
                  <div className="flex items-center justify-between mb-8">
                    <button 
                      onClick={() => setView('revision')}
                      className="flex items-center gap-1 text-slate-500 hover:text-indigo-600 font-medium transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                      Quitter
                    </button>
                    <div className="flex-1 mx-8 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-indigo-600"
                        initial={{ width: 0 }}
                        animate={{ width: `${((cardIndex + 1) / currentSet.cards.length) * 100}%` }}
                      />
                    </div>
                    <div className="font-bold text-indigo-600">Score: {quizScore}</div>
                  </div>

                  <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl mb-6">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 block">Question {cardIndex + 1}</span>
                    <h3 className="text-2xl font-bold text-slate-800 mb-8">
                      {currentSet.cards[cardIndex].question}
                    </h3>

                    <div className="space-y-3">
                      {quizOptions.map((option, i) => {
                        const isCorrect = option === currentSet.cards[cardIndex].answer;
                        const isSelected = selectedOption === option;
                        
                        let bgColor = "bg-white border-slate-200 hover:border-indigo-300";
                        if (selectedOption) {
                          if (isCorrect) bgColor = "bg-green-50 border-green-500 text-green-700";
                          else if (isSelected) bgColor = "bg-red-50 border-red-500 text-red-700";
                          else bgColor = "bg-slate-50 border-slate-200 opacity-50";
                        }

                        return (
                          <button
                            key={i}
                            onClick={() => handleQuizAnswer(option)}
                            disabled={!!selectedOption}
                            className={`w-full text-left p-4 rounded-2xl border-2 font-medium transition-all flex items-center justify-between ${bgColor}`}
                          >
                            <span>{option}</span>
                            {selectedOption && isCorrect && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                            {selectedOption && isSelected && !isCorrect && <XCircle className="w-5 h-5 text-red-500" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-white p-12 rounded-3xl border border-slate-200 shadow-2xl text-center">
                  <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <GraduationCap className="w-10 h-10" />
                  </div>
                  <h2 className="text-4xl font-bold mb-2">Quiz Terminé !</h2>
                  <p className="text-slate-500 mb-8">Excellent travail sur "{currentSet.title}"</p>
                  
                  <div className="text-6xl font-black text-indigo-600 mb-10">
                    {quizScore} <span className="text-2xl text-slate-300">/ {currentSet.cards.length}</span>
                  </div>

                  {quizScore < 8 && (
                    <div className="mb-10 text-left bg-amber-50 p-6 rounded-2xl border border-amber-100">
                      <h3 className="text-lg font-bold text-amber-800 mb-3 flex items-center gap-2">
                        <Lightbulb className="w-5 h-5" />
                        Points à améliorer
                      </h3>
                      {isAnalyzing ? (
                        <div className="flex items-center gap-2 text-amber-600 italic">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Analyse de tes erreurs...
                        </div>
                      ) : (
                        <div className="prose prose-sm text-amber-900">
                          <Markdown>{pointsToImprove || "Revois bien les points clés de la fiche de révision pour progresser !"}</Markdown>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-4">
                    <button 
                      onClick={startQuiz}
                      className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-5 h-5" />
                      Recommencer
                    </button>
                    <button 
                      onClick={() => setView('revision')}
                      className="flex-1 py-4 bg-slate-100 text-slate-700 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                    >
                      Retour aux cartes
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <style>{`
        .perspective-1000 {
          perspective: 1000px;
        }
        .preserve-3d {
          transform-style: preserve-3d;
        }
        .backface-hidden {
          backface-visibility: hidden;
        }
      `}</style>
    </div>
  );
}
