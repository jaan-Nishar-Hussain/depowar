import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import svgPaths from "../imports/svg-ljngie7irj";
import arrowSvgPaths from "../imports/svg-lrkih46fki";
import Group4 from "../imports/Group41";
import { AbsorptionAnimation } from "../imports/absorption-animation";
import handImg from "figma:asset/17e1b53b5e683d2a4d053a522e1b91b514e1d39d.png";
import signatureImg from "figma:asset/da37525fbf6c95580867409c00494c47e71fbac7.png";
import PhoneImg from "figma:asset/808046c45da9508440bc38e8447cd98fbf624517.png";
import iPodImg from "figma:asset/bbd6a1f54722b91e4d47148252b69ff863851bcd.png";
import SafariImg from "figma:asset/7622e9d569772c15c7939f8b5a02bb960011c0d2.png";

export default function App() {
  const [scrollY, setScrollY] = useState(0);
  const [vh, setVh] = useState(() => typeof window !== "undefined" ? window.innerHeight : 0);
  const [vw, setVw] = useState(() => typeof window !== "undefined" ? window.innerWidth : 0);
  const textRef = useRef<HTMLDivElement>(null);
  const [textWidth, setTextWidth] = useState(0);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const [unlocked, setUnlocked] = useState(false);
  const [unlockAnim, setUnlockAnim] = useState(0); // 0 to 1 animation progress
  const unlockAnimRef = useRef<number>(0);
  const unlockRafRef = useRef<number | null>(null);
  const unlockScrollY = useRef<number>(0); // scroll position when unlocked
  const [iconsAnimDone, setIconsAnimDone] = useState(false);
  const [phase7SwipeTriggered, setPhase7SwipeTriggered] = useState(false);
  const [phase7Text2Visible, setPhase7Text2Visible] = useState(false);
  const [phase7HandExit, setPhase7HandExit] = useState(false);
  const phase7HandExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Randomized icon order for Phase 6 animation
  const iconNames = useMemo(() => {
    const names = [
      "Text", "Calendar", "Photos", "Camera",
      "YouTube", "Stocks", "Maps", "Weather",
      "Clock", "Calculator", "Notes", "Settings",
      "Phone", "Mail", "Safari", "iPod",
    ];
    // Fisher-Yates shuffle
    const shuffled = [...names];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, []);

  const getMaxDrag = useCallback(() => {
    if (!sliderRef.current) return 0;
    const sliderWidth = sliderRef.current.offsetWidth;
    // Arrow button width scales with clamp: ~24% of slider width
    const thumbWidth = sliderWidth * 0.244;
    return sliderWidth - thumbWidth - 4; // 2px padding each side
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartOffset.current = dragX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [dragX]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const delta = e.clientX - dragStartX.current;
    const maxDrag = getMaxDrag();
    const newX = Math.min(Math.max(dragStartOffset.current + delta, 0), maxDrag);
    setDragX(newX);
  }, [isDragging, getMaxDrag]);

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    const maxDrag = getMaxDrag();
    // If dragged past 90%, consider it "unlocked" — otherwise snap back
    if (dragX < maxDrag * 0.9) {
      setDragX(0);
    } else {
      setUnlocked(true);
      setUnlockAnim(0);
      unlockAnimRef.current = 0;
      unlockScrollY.current = window.scrollY;
      const startTime = performance.now();
      const duration = 1200; // 1.2 seconds
      const animateUnlock = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        unlockAnimRef.current = progress;
        setUnlockAnim(progress);
        if (progress < 1) {
          unlockRafRef.current = requestAnimationFrame(animateUnlock);
        }
      };
      unlockRafRef.current = requestAnimationFrame(animateUnlock);
    }
  }, [isDragging, dragX, getMaxDrag]);

  const measureText = useCallback(() => {
    if (textRef.current) {
      setTextWidth(textRef.current.scrollWidth);
    }
  }, []);

  useEffect(() => {
    setVh(window.innerHeight);
    setVw(window.innerWidth);

    const handleResize = () => {
      setVh(window.innerHeight);
      setVw(window.innerWidth);
    };

    const handleScroll = () => {
      setScrollY(window.scrollY);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    measureText();
  }, [vh, vw, measureText]);

  // Scroll lock: block scrolling past the lock point when words are revealed but not yet unlocked
  useEffect(() => {
    if (!unlocked && vh > 0) {
      const logoMaxScroll_ = vh * 3;
      const textScrollStart_ = logoMaxScroll_ + vh * 0.5;
      const textScrollEnd_ = textScrollStart_ + vh * 5;
      const phase3Start_ = textScrollEnd_;
      const phase3Length_ = vh * 4;
      const lockPos = phase3Start_ + phase3Length_ * 0.65;

      if (scrollY > lockPos) {
        window.scrollTo({ top: lockPos, behavior: "instant" as ScrollBehavior });
      }
    }
  }, [scrollY, unlocked, vh]);

  // Reset unlock state when scrolling back up into phase 3 territory
  useEffect(() => {
    if (unlocked && unlockAnim >= 1) {
      // Calculate phase3End threshold to know when to reset
      const logoMaxScroll = vh * 3;
      const textScrollStart = logoMaxScroll + vh * 0.5;
      const textScrollLength = vh * 5;
      const textScrollEnd = textScrollStart + textScrollLength;
      const phase3Start = textScrollEnd;
      const phase3Length = vh * 4;
      const lockPos = phase3Start + phase3Length * 0.5;

      if (scrollY < lockPos) {
        // Cancel any ongoing animation
        if (unlockRafRef.current) {
          cancelAnimationFrame(unlockRafRef.current);
          unlockRafRef.current = null;
        }
        setUnlocked(false);
        setUnlockAnim(0);
        unlockAnimRef.current = 0;
        setDragX(0);
        setIconsAnimDone(false);
      }
    }
  }, [scrollY, unlocked, unlockAnim, vh]);

  // Track when icons animation completes (scroll-driven, no timer)
  useEffect(() => {
    const logoMaxScroll_ = vh * 3;
    const textScrollStart_ = logoMaxScroll_ + vh * 0.5;
    const textScrollEnd_ = textScrollStart_ + vh * 5;
    const phase3End_ = textScrollEnd_ + vh * 4;
    const phase4End_ = phase3End_ + vh * 2 * 7;
    const phase5End_ = phase4End_ + vh * 14;
    const phase6Start_ = phase5End_;
    const phase6Length_ = vh * 4;
    const phase6Progress_ = Math.min(Math.max((scrollY - phase6Start_) / phase6Length_, 0), 1);
    const isInPhase6_ = unlocked && unlockAnim >= 1 && scrollY >= phase6Start_;
    const iconRevealProgress_ = Math.min(Math.max((phase6Progress_ - 0.45) / 0.40, 0), 1);
    const allRevealed = isInPhase6_ && iconRevealProgress_ >= 1;

    if (allRevealed && !iconsAnimDone) {
      setIconsAnimDone(true);
    }
    if (!isInPhase6_ || phase6Progress_ < 0.45) {
      setIconsAnimDone(false);
    }
  }, [scrollY, vh, unlocked, unlockAnim, iconsAnimDone]);

  // Trigger phase 7 text when scroll reaches the trigger point
  useEffect(() => {
    // Recompute phase 7 values inside effect to avoid referencing variables before initialization
    const logoMaxScroll_ = vh * 3;
    const textScrollStart_ = logoMaxScroll_ + vh * 0.5;
    const textScrollEnd_ = textScrollStart_ + vh * 5;
    const phase3End_ = textScrollEnd_ + vh * 4;
    const phase4End_ = phase3End_ + vh * 2 * 7;
    const phase5End_ = phase4End_ + vh * 14;
    const phase6End_ = phase5End_ + vh * 4;
    const phase7Start_ = phase6End_;
    const phase7Length_ = vh * 10;
    const phase7Progress_ = Math.min(Math.max((scrollY - phase7Start_) / phase7Length_, 0), 1);
    const isInPhase7_ = iconsAnimDone && scrollY >= phase7Start_;
    const phase7SwipeTrigger_ = phase7Progress_ > 0.55;

    if (isInPhase7_ && phase7SwipeTrigger_ && !phase7SwipeTriggered) {
      setPhase7SwipeTriggered(true);
    }
    if (!isInPhase7_) {
      setPhase7SwipeTriggered(false);
      setPhase7Text2Visible(false);
      setPhase7HandExit(false);
    }
  }, [scrollY, vh, iconsAnimDone, phase7SwipeTriggered]);

  // After swipe completes: hand slides down + text1 fades + text2 appears
  useEffect(() => {
    if (phase7SwipeTriggered && !phase7HandExit) {
      phase7HandExitTimerRef.current = setTimeout(() => {
        setPhase7HandExit(true);
        setPhase7Text2Visible(true);
      }, 500);
    }
    if (!phase7SwipeTriggered) {
      setPhase7HandExit(false);
      setPhase7Text2Visible(false);
      if (phase7HandExitTimerRef.current) {
        clearTimeout(phase7HandExitTimerRef.current);
        phase7HandExitTimerRef.current = null;
      }
    }
    return () => {
      if (phase7HandExitTimerRef.current) {
        clearTimeout(phase7HandExitTimerRef.current);
      }
    };
  }, [phase7SwipeTriggered, phase7HandExit]);

  if (vh === 0) return <div className="relative bg-white" style={{ height: "100vh" }} />;

  const smoothstep = (t: number) => t * t * (3 - 2 * t);

  // ===== PHASE 1: Logo animation (0 to 3vh scroll) =====
  const logoMaxScroll = vh * 3;
  const logoProgress = Math.min(scrollY / logoMaxScroll, 1);

  // Phase 1a: Intro scale 110% → 100% is handled by CSS animation on mount (time-based)
  // Phase 1b: Zoom up on scroll — scale 1 → fills the screen
  const zoomEased = smoothstep(logoProgress);
  const zoomScale = 1 + zoomEased * 20;

  const finalScale = zoomScale;
  const logoWidth = 58 * finalScale;
  const logoHeight = 72 * finalScale;

  // Fade to black
  const fadeStart = 0.45;
  const fadeEnd = 0.75;
  const fadeProg = Math.min(Math.max((logoProgress - fadeStart) / (fadeEnd - fadeStart), 0), 1);
  const bgOpacity = fadeProg * fadeProg;

  const isBlack = logoProgress >= 0.75;

  // ===== PHASE 2: Horizontal text scroll (3vh to 3vh + textScroll) =====
  const textScrollStart = logoMaxScroll + vh * 0.5;
  const horizontalDistance = textWidth;
  const textScrollLength = vh * 5;
  const textScrollEnd = textScrollStart + textScrollLength;

  const textProgress = Math.min(
    Math.max((scrollY - textScrollStart) / textScrollLength, 0),
    1
  );
  const textTranslateX = -textProgress * horizontalDistance;

  // Text fade in
  const textFadeInStart = logoMaxScroll;
  const textFadeInEnd = textScrollStart;
  const textOpacity = Math.min(
    Math.max((scrollY - textFadeInStart) / (textFadeInEnd - textFadeInStart), 0),
    1
  );

  // ===== PHASE 3: "Reinvent the phone" word-by-word reveal =====
  const phase3Words = "Today, Apple is going to reinvent the phone.".split(" ");
  const phase3Start = textScrollEnd;
  const phase3Length = vh * 4;
  const phase3End = phase3Start + phase3Length;
  const phase3Progress = Math.min(
    Math.max((scrollY - phase3Start) / phase3Length, 0),
    1
  );

  // Each word gets a staggered window — compressed into first 60% of phase3
  const phase3WordProgress = Math.min(phase3Progress / 0.6, 1);
  const wordCount = phase3Words.length;
  const staggerOverlap = 0.4; // overlap between words
  const wordDuration = 1 / (wordCount * (1 - staggerOverlap) + staggerOverlap);

  const getWordProgress = (index: number) => {
    const wordStart = index * wordDuration * (1 - staggerOverlap);
    const wordEnd = wordStart + wordDuration;
    return Math.min(Math.max((phase3WordProgress - wordStart) / (wordEnd - wordStart), 0), 1);
  };

  // All words fully revealed?
  const phase3AllWordsRevealed = phase3WordProgress >= 1; // phase3Progress >= 0.6

  // Scroll lock position: where all words are visible
  const scrollLockPosition = phase3Start + phase3Length * 0.65;

  // Phase 3 visibility: show when phase 2 text has scrolled away
  const phase3Visible = scrollY >= textScrollEnd - vh * 0.5;

  // Slide to unlock: appears once all words are revealed
  const slideUnlockOpacity = phase3AllWordsRevealed
    ? Math.min((phase3Progress - 0.6) / 0.08, 1)
    : 0;

  // Unlock animation easing
  const unlockEased = unlocked ? smoothstep(Math.min(unlockAnim, 1)) : 0;

  // Phase 3 content opacity (fades out when unlocked)
  const phase3ContentOpacity = unlocked ? 1 - unlockEased : 1;

  // Black overlay opacity (fades from 1 to 0 when unlocked)
  const blackOverlayOpacity = unlocked ? 1 - unlockEased : (isBlack ? 1 : bgOpacity);

  // iPhone text animation
  const iphoneOpacity = unlockEased;
  const iphoneTranslateY = 40 * (1 - unlockEased); // moves from 40px below to 0

  // ===== PHASE 4: Word cylinder (scroll-driven after unlock) =====
  const phase4Words = [
    "iPhone",
    "Works like magic",
    "No stylus",
    "Far more accurate",
    "Ignores unintended touches",
    "Multi-finger gestures",
    "Patented",
  ];
  const phase4Start = phase3End;
  const phase4LengthPerWord = vh * 2;
  const phase4Length = phase4LengthPerWord * phase4Words.length;
  const phase4End = phase4Start + phase4Length;

  // Cylinder rotation: each face is 360/N degrees apart, rotate around X axis
  const phase4AnglePerFace = 360 / phase4Words.length;
  const phase4ScrollProgress = Math.min(Math.max((scrollY - phase4Start) / (phase4Length - phase4LengthPerWord), 0), 1);
  const phase4RotationX = phase4ScrollProgress * (phase4Words.length - 1) * phase4AnglePerFace;
  // Cylinder radius based on viewport — smaller on mobile to keep text contained
  const phase4CylinderRadius = vw < 768 ? Math.max(vh * 0.35, 200) : Math.max(vh * 0.55, 350);

  const isInPhase4 = unlocked && unlockAnim >= 1 && scrollY >= phase4Start;

  // Phase 4 exit: fade out during last word's scroll segment for transition to phase 5
  const phase4ExitProgress = Math.min(Math.max((scrollY - (phase4End - phase4LengthPerWord * 0.6)) / (phase4LengthPerWord * 0.6), 0), 1);
  const phase4ExitOpacity = 1 - smoothstep(phase4ExitProgress);

  // ===== PHASE 5: 3D Cube with icons (Phone, iPod, Safari) =====
  const phase5Start = phase4End;
  const phase5Length = vh * 14; // longer scroll for 2 full cycles
  const phase5End = phase5Start + phase5Length;
  const phase5ScrollY = Math.max(scrollY - phase5Start, 0);
  const phase5Progress = Math.min(phase5ScrollY / phase5Length, 1);

  // Cube entrance: fade in from "Patented" exit
  const cubeEnterProgress = Math.min(phase5Progress / 0.06, 1);
  const cubeEnterEased = smoothstep(cubeEnterProgress);

  // Cube rotation: 6 faces at 60° intervals, rotate from 0 to -300°
  const cubeRotateProgress = Math.max((phase5Progress - 0.06) / 0.94, 0);
  const cubeRotateY = cubeRotateProgress * -300; // 0 to -300 degrees

  // Progressive scale: cube grows as user scrolls through faces
  const cubeGrowScale = 1 + smoothstep(cubeRotateProgress) * 0.8; // 1x → 1.8x
  // Offset to push labels down so they don't overlap the growing cube
  const cubeLabelOffsetY = (cubeGrowScale - 1) * 140; // px shift downward

  // Labels for each face (2 cycles of 3)
  const cubeLabels6 = [
    "An iPod", "A phone", "An internet communicator.",
    "An iPod", "A phone", "An internet communicator.",
  ];
  const cubeFaceCenters = [0, 60, 120, 180, 240, 300];
  const normalizedAngle = -cubeRotateY; // 0 to 300
  let cubeFaceIndex = 0;
  let cubeMinDist = Infinity;
  cubeFaceCenters.forEach((c, i) => {
    const dist = Math.abs(normalizedAngle - c);
    if (dist < cubeMinDist) { cubeMinDist = dist; cubeFaceIndex = i; }
  });

  // Label opacity: fade based on distance from face center (30° = fully faded)
  const labelOpacity = Math.max(1 - cubeMinDist / 30, 0);

  // "Are you getting it?" appears when last face (index 5 = second "internet communicator") is showing
  const isLastFace = cubeFaceIndex === 5;
  const lastFaceProgress = Math.max(1 - Math.abs(normalizedAngle - 300) / 30, 0);
  // Delay the subtitle slightly after the label appears
  const subtitleProgress = Math.max((lastFaceProgress - 0.4) / 0.6, 0);
  const subtitleEased = smoothstep(subtitleProgress);

  // Phase 5 exit fade-out: last 8% of scroll fades everything out smoothly
  const phase5ExitFadeStart = 0.92;
  const phase5ExitFadeProgress = Math.min(Math.max((phase5Progress - phase5ExitFadeStart) / (1 - phase5ExitFadeStart), 0), 1);
  const phase5ExitOpacity = 1 - smoothstep(phase5ExitFadeProgress);

  // Keep phase 5 visible slightly into phase 6 scroll to allow crossfade overlap
  const isInPhase5 = unlocked && unlockAnim >= 1 && scrollY >= phase5Start && scrollY < phase5End + vh * 0.3;
  // Phase 4 should not show when in phase 5
  const showPhase4 = isInPhase4 && !isInPhase5;

  // ===== PHASE 6: iPhone arrives from bottom, icons animate in =====
  const phase6Start = phase5End;
  const phase6Length = vh * 4;
  const phase6End = phase6Start + phase6Length;
  const phase6Progress = Math.min(Math.max((scrollY - phase6Start) / phase6Length, 0), 1);
  const isInPhase6 = unlocked && unlockAnim >= 1 && scrollY >= phase6Start;

  // Icons appear progressively based on scroll (not CSS animation)
  // iconRevealProgress: 0 at phase6Progress=0.45, 1 at phase6Progress=0.85
  const iconRevealProgress = Math.min(Math.max((phase6Progress - 0.45) / 0.40, 0), 1);

  // Generate scroll-driven CSS for each icon
  const scrollDrivenIconStyles = iconNames.map((name, i) => {
    const iconStart = i / iconNames.length;
    const iconEnd = (i + 2) / iconNames.length; // overlap for smoother stagger
    const raw = Math.min(Math.max((iconRevealProgress - iconStart) / (iconEnd - iconStart), 0), 1);
    const eased = raw * raw * (3 - 2 * raw); // smoothstep
    const opacity = eased;
    const scale = 1.1 - 0.1 * eased; // 1.1 → 1.0
    return `[data-name="icons"][data-icon="${name}"] { opacity: ${opacity.toFixed(4)} !important; transform: scale(${scale.toFixed(4)}) !important; }`;
  }).join("\n");

  // All icons are visible when last icon is fully revealed
  const allIconsRevealed = iconRevealProgress >= 1;

  // Phone slides in from the bottom: completes during first 45% of phase 6
  const phoneSlideProgress = smoothstep(Math.min(phase6Progress / 0.45, 1));
  const phoneSlideY = (1 - phoneSlideProgress) * 100; // 100vh → 0
  // Phone opacity: fade in quickly at the start
  const phoneOverallOpacity = smoothstep(Math.min(phase6Progress / 0.18, 1));

  // Icons animate in after phone has landed (progress > 0.45)
  const shouldAnimateIcons = isInPhase6 && phase6Progress > 0.45;
  const iphoneIconClass = shouldAnimateIcons
    ? "iphone-icons-active"
    : isInPhase6
    ? "iphone-icons-hidden"
    : "";

  // Scale phone to fit viewport (original design: 391 × 746 — iPhone 2007)
  const phoneScale = Math.min(1, (vh * 0.88) / 746, (vw * 0.88) / 391);

  // ===== PHASE 7: Hand + Absorption Animation (after icons animation done) =====
  // Hand slides up with CSS transition once iconsAnimDone is true
  // Absorption animation appears in the center
  const phase7Start = phase6End;
  const phase7Length = vh * 10;
  const phase7End = phase7Start + phase7Length;
  const phase7Progress = Math.min(Math.max((scrollY - phase7Start) / phase7Length, 0), 1);
  const isInPhase7 = iconsAnimDone && scrollY >= phase7Start;

  // Phase 6 → 7 transition: fade phone out during last 35% of phase 6 when icons are done
  const phase6ExitProgress = iconsAnimDone
    ? smoothstep(Math.min(Math.max((phase6Progress - 0.65) / 0.35, 0), 1))
    : 0;
  const phase6FadeOut = 1 - phase6ExitProgress;

  // Phase 7 background: fade to black
  const phase7BgOpacity = isInPhase7 ? smoothstep(Math.min(phase7Progress / 0.15, 1)) : phase6ExitProgress;

  // Hand slide-up: translateY from 100% to 20% (finger pointing to center)
  const handSlideProgress = smoothstep(Math.min(phase7Progress / 0.35, 1));
  const handTranslateY = (1 - handSlideProgress) * 100; // 100% → 0%

  // Absorption animation: fade in after hand has reached its position
  const absorptionFadeProgress = smoothstep(Math.min(Math.max((phase7Progress - 0.2) / 0.2, 0), 1));

  // Phase 7 text: triggers after hand + absorption are settled
  const phase7TextTrigger = phase7Progress > 0.45;

  // Phase 7 text word-by-word reveal (scroll-driven, 0.08 → 0.35)
  const phase7Text1Words = "We're going to use the best pointing device in the world. We're going to use a pointing device that we're all born with. Born with ten of them. We're going to use our fingers.".split(" ");
  const phase7WordRevealStart = 0.08;
  const phase7WordRevealEnd = 0.35;
  const phase7WordRevealRange = phase7WordRevealEnd - phase7WordRevealStart;
  const getPhase7WordProgress = (index: number) => {
    const totalWords = phase7Text1Words.length;
    const wordStart = phase7WordRevealStart + (index / totalWords) * phase7WordRevealRange;
    const wordEnd = wordStart + (2 / totalWords) * phase7WordRevealRange; // overlap for smoothness
    const raw = Math.min(Math.max((phase7Progress - wordStart) / (wordEnd - wordStart), 0), 1);
    return raw * raw * (3 - 2 * raw); // smoothstep
  };
  // All words revealed?
  const phase7AllWordsRevealed = phase7Progress >= phase7WordRevealEnd;

  // Hand appears after all words revealed (scroll-driven, 0.37 → 0.45)
  const phase7HandProgress = Math.min(Math.max((phase7Progress - 0.37) / 0.08, 0), 1);
  const phase7HandSmooth = phase7HandProgress * phase7HandProgress * (3 - 2 * phase7HandProgress);

  // Total page height
  const totalHeight = phase7End + vh * 2;

  // Show logo phase or text phase
  const showLogo = logoProgress < 1;

  return (
    <div className="relative bg-white" style={{ height: totalHeight }}>
      {/* Dynamic randomized icon animation styles */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes phase7WordReveal {
          0% {
            opacity: 0;
            filter: blur(50px);
            transform: translateY(30px);
          }
          100% {
            opacity: 1;
            filter: blur(0px);
            transform: translateY(0px);
          }
        }
        @keyframes handSwipeLeft {
          0% { transform: translateX(0); }
          50% { transform: translateX(clamp(-120px, -20vw, -80px)); }
          100% { transform: translateX(0); }
        }
        @keyframes handSlideDown {
          0% { transform: translate(calc(-50% + clamp(80px, 15vw, 150px)), 0%); opacity: 1; }
          100% { transform: translate(calc(-50% + clamp(80px, 15vw, 150px)), 100%); opacity: 0; }
        }
        @keyframes phase7Text2SlideIn {
          0% {
            opacity: 0;
            filter: blur(30px);
            transform: translateX(80px);
          }
          100% {
            opacity: 1;
            filter: blur(0px);
            transform: translateX(0);
          }
        }
        @keyframes signatureReveal {
          0% { width: 100%; }
          100% { width: 0%; }
        }
        @keyframes logoIntro {
          0% { opacity: 0; transform: scale(1.1); }
          100% { opacity: 1; transform: scale(1); }
        }
        ${scrollDrivenIconStyles}
      `}} />
      {/* Fixed centered logo */}
      {showLogo && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-10 overflow-clip">
          <div
            style={{
              animation: "logoIntro 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards",
              opacity: 0,
              willChange: "opacity, transform",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <svg
              style={{
                width: logoWidth,
                height: logoHeight,
                willChange: "width, height",
              }}
              fill="none"
              preserveAspectRatio="xMidYMid meet"
              viewBox="0 0 58 72"
            >
              <g clipPath="url(#clip0_logo)">
                <path d={svgPaths.p1b40e300} fill="black" />
              </g>
              <defs>
                <clipPath id="clip0_logo">
                  <rect fill="white" height="72" width="58" />
                </clipPath>
              </defs>
            </svg>
            <span
              style={{
                marginTop: 12,
                fontSize: "clamp(0.7rem, 1.5vw, 0.95rem)",
                letterSpacing: "0.04em",
                color: "black",
              }}
            >
              January 9, 2007
            </span>
          </div>
        </div>
      )}

      {/* Black overlay / background */}
      <div
        className="fixed inset-0 pointer-events-none z-20 bg-black"
        style={{ opacity: blackOverlayOpacity }}
      />

      {/* Horizontal scrolling text — always in DOM for measurement */}
      <div
        className="fixed inset-0 z-30 flex items-center overflow-hidden pointer-events-none"
        style={{ opacity: isBlack ? textOpacity : 0, visibility: isBlack ? "visible" : "hidden" }}
      >
        <div
          ref={textRef}
          className="whitespace-nowrap text-white px-[50vw]"
          style={{
            transform: `translateX(${textTranslateX}px)`,
            willChange: "transform",
            fontSize: "clamp(3.5rem, 8vw, 7rem)",
            letterSpacing: "-0.02em",
          }}
        >
          Every once in a while, a revolutionary product comes along that changes everything.
        </div>
      </div>

      {/* Phase 3: Word-by-word reveal */}
      {phase3Visible && !( unlocked && unlockAnim >= 1) && (
        <div
          className="fixed inset-0 z-30 flex flex-col items-center justify-center pointer-events-none"
        >
          <p
            className="text-white text-center px-8 flex flex-wrap justify-center gap-x-[0.35em] gap-y-0"
            style={{
              fontSize: "clamp(2.5rem, 7vw, 5rem)",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              maxWidth: "900px",
              opacity: phase3ContentOpacity,
            }}
          >
            {phase3Words.map((word, i) => {
              const wp = getWordProgress(i);
              const eased = smoothstep(wp);
              const blur = 100 * (1 - eased);
              const opacity = eased;
              return (
                <span
                  key={i}
                  style={{
                    opacity,
                    filter: `blur(${blur}px)`,
                    willChange: "opacity, filter",
                  }}
                >
                  {word}
                </span>
              );
            })}
          </p>
        </div>
      )}

      {/* Slide to unlock — fixed bottom */}
      {phase3Visible && !(unlocked && unlockAnim >= 1) && (
        <div
          className="fixed z-30 left-0 right-0 flex justify-center pointer-events-none"
          style={{
            bottom: "clamp(16px, 4vh, 32px)",
            opacity: Math.min(slideUnlockOpacity, phase3ContentOpacity),
          }}
        >
            <div
              ref={sliderRef}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                width: vw < 768 ? "clamp(275px, 70vw, 425px)" : "clamp(220px, 42vw, 340px)",
                aspectRatio: "279 / 53",
                padding: "clamp(2px, 0.4vw, 3px)",
                boxSizing: "border-box",
                backgroundImage: "linear-gradient(179.502deg, rgb(0, 0, 0) 2.1886%, rgba(0, 0, 0, 0.59) 63.6%, rgba(0, 0, 0, 0) 105.94%)",
                border: "1px solid #505050",
                borderRadius: "clamp(9px, 1.6vw, 12px)",
                overflow: "hidden",
              }}
            >
              {/* Arrow button — draggable */}
              <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{
                  flexShrink: 0,
                  marginLeft: `${dragX}px`,
                  cursor: isDragging ? "grabbing" : "grab",
                  pointerEvents: "auto",
                  touchAction: "none",
                  userSelect: "none",
                  zIndex: 2,
                  transition: isDragging ? "none" : "margin-left 0.3s ease-out",
                  width: "24.4%",
                  aspectRatio: "68 / 47",
                  borderRadius: "clamp(6px, 1vw, 8px)",
                  boxShadow: "0px 1px 2px 0px rgba(0,0,0,0.25)",
                  backgroundImage: "linear-gradient(rgb(240, 240, 240) 0%, rgb(240, 240, 240) 21.348%, rgb(224, 224, 224) 47.551%, rgb(207, 207, 207) 47.588%, rgb(175, 175, 175) 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg
                  style={{
                    width: "44%",
                    height: "auto",
                    pointerEvents: "none",
                    display: "block",
                  }}
                  fill="none"
                  preserveAspectRatio="xMidYMid meet"
                  viewBox="0 0 30 23.3828"
                >
                  <path d={arrowSvgPaths.p271850f0} fill="color(display-p3 0.549 0.549 0.549)" />
                </svg>
              </div>
              {/* Text centered in the space to the right of the arrow button */}
              <span
                className="font-['SF_Pro_Text',sans-serif]"
                style={{
                  position: "absolute",
                  left: "24.4%",
                  right: 0,
                  top: "50%",
                  transform: "translateY(-50%)",
                  textAlign: "center",
                  fontSize: vw < 768 ? "clamp(1.0rem, 3.5vw, 1.3rem)" : "clamp(0.85rem, 2vw, 1.3rem)",
                  letterSpacing: "-0.01em",
                  backgroundImage: "linear-gradient(-90deg, rgba(254, 254, 254, 0.4) 0%, rgba(254, 254, 254, 0.93) 35.722%, rgb(254, 254, 254) 54.386%, rgba(254, 254, 254, 0.824) 77.298%, rgba(254, 254, 254, 0.4) 101.72%)",
                  backgroundSize: "200% auto",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  animation: "slide-to-unlock 2.5s linear infinite",
                  pointerEvents: "none",
                  opacity: 1 - (getMaxDrag() > 0 ? dragX / getMaxDrag() : 0),
                }}
              >
                slide to unlock
              </span>
            </div>
        </div>
      )}

      {/* iPhone reveal — appears after unlock, before phase 4 scroll */}
      {unlocked && !isInPhase4 && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none"
        >
          <h1
            style={{
              color: "black",
              fontSize: "clamp(4rem, 12vw, 10rem)",
              letterSpacing: "-0.03em",
              opacity: iphoneOpacity,
              transform: `translateY(${iphoneTranslateY}px)`,
              willChange: "opacity, transform",
            }}
          >
            iPhone
          </h1>
        </div>
      )}

      {/* Phase 4: Word cylinder — scroll-driven */}
      {showPhase4 && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none px-6"
          style={{ opacity: phase4ExitOpacity }}
        >
          {/* 3D perspective wrapper */}
          <div
            style={{
              perspective: "1200px",
              perspectiveOrigin: "50% 50%",
              width: "100%",
              maxWidth: "900px",
              height: `${phase4CylinderRadius * 2}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Rotating cylinder */}
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                transformStyle: "preserve-3d",
                transform: `rotateX(${-phase4RotationX}deg)`,
                willChange: "transform",
              }}
            >
              {phase4Words.map((word, i) => {
                const angle = i * phase4AnglePerFace;
                // Calculate how far this face is from the front-facing position
                const angleDiff = ((phase4RotationX - angle) % 360 + 360) % 360;
                const normalizedDiff = angleDiff > 180 ? 360 - angleDiff : angleDiff;
                // Opacity: full at front, fades as it rotates away
                const faceOpacity = Math.max(1 - normalizedDiff / 45, 0);
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      top: "50%",
                      left: 0,
                      transform: `translateY(-50%) rotateX(${angle}deg) translateZ(${phase4CylinderRadius}px)`,
                      backfaceVisibility: "hidden",
                      opacity: faceOpacity,
                      padding: vw < 768 ? "0 24px" : "0",
                    }}
                  >
                    <span
                      style={{
                        color: "black",
                        fontSize: vw < 768 ? "clamp(1.4rem, 5.5vw, 2rem)" : "clamp(2.2rem, 5vw, 4rem)",
                        letterSpacing: "-0.03em",
                        lineHeight: 1.15,
                        textAlign: "center",
                        whiteSpace: "normal",
                        overflowWrap: "break-word",
                        maxWidth: vw < 768 ? "80vw" : "none",
                      }}
                    >
                      {word}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Phase 5: 3D Cube with icons (Phone, iPod, Safari) */}
      {isInPhase5 && (
        <div
          className="fixed inset-0 z-40 flex flex-col items-center justify-center pointer-events-none px-6"
          style={{
            opacity: cubeEnterEased * phase5ExitOpacity,
            willChange: "opacity",
          }}
        >
          {/* 3D scene wrapper with perspective */}
          <div
            style={{
              perspective: "1200px",
              perspectiveOrigin: "50% 50%",
              width: "clamp(160px, 28vw, 280px)",
              height: "clamp(160px, 28vw, 280px)",
              transform: `scale(${cubeGrowScale})`,
              willChange: "transform",
            }}
          >
            {/* Cube that rotates */}
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                transformStyle: "preserve-3d",
                transform: `rotateY(${cubeRotateY}deg)`,
                willChange: "transform",
              }}
            >
              {/* Face 0: iPod — 0° */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  transform: `rotateY(0deg) translateZ(clamp(139px, 24vw, 243px))`,
                }}
              >
                <img src={iPodImg} alt="iPod" draggable={false} style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }} />
              </div>

              {/* Face 1: Phone — 60° */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  transform: `rotateY(60deg) translateZ(clamp(139px, 24vw, 243px))`,
                }}
              >
                <img src={PhoneImg} alt="Phone" draggable={false} style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }} />
              </div>

              {/* Face 2: Safari — 120° */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  transform: `rotateY(120deg) translateZ(clamp(139px, 24vw, 243px))`,
                }}
              >
                <img src={SafariImg} alt="Internet communicator" draggable={false} style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }} />
              </div>

              {/* Face 3: iPod — 180° (second cycle) */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  transform: `rotateY(180deg) translateZ(clamp(139px, 24vw, 243px))`,
                }}
              >
                <img src={iPodImg} alt="iPod" draggable={false} style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }} />
              </div>

              {/* Face 4: Phone — 240° (second cycle) */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  transform: `rotateY(240deg) translateZ(clamp(139px, 24vw, 243px))`,
                }}
              >
                <img src={PhoneImg} alt="Phone" draggable={false} style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }} />
              </div>

              {/* Face 5: Safari — 300° (second cycle) */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  transform: `rotateY(300deg) translateZ(clamp(139px, 24vw, 243px))`,
                }}
              >
                <img src={SafariImg} alt="Internet communicator" draggable={false} style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }} />
              </div>
            </div>
          </div>

          {/* Label below cube */}
          <div
            style={{
              marginTop: "clamp(32px, 5vh, 64px)",
              transform: `translateY(${cubeLabelOffsetY}px)`,
              textAlign: "center",
              position: "relative",
              height: "clamp(2.5rem, 6vw, 5rem)",
              willChange: "transform",
            }}
          >
            {cubeLabels6.map((label, i) => (
              <span
                key={`face-${i}`}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  fontSize: "clamp(2rem, 5vw, 4.5rem)",
                  letterSpacing: "-0.02em",
                  color: "black",
                  opacity: cubeFaceIndex === i ? labelOpacity : 0,
                  willChange: "opacity",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            ))}

            {/* Subtitle "Are you getting it?" — always in DOM, absolute positioned */}
            <span
              style={{
                position: "absolute",
                left: "50%",
                top: "100%",
                transform: `translate(-50%, ${12 * (1 - subtitleEased)}px)`,
                marginTop: "clamp(8px, 1.5vh, 16px)",
                textAlign: "center",
                fontSize: "clamp(1.2rem, 3vw, 2.2rem)",
                letterSpacing: "-0.01em",
                color: "black",
                opacity: isLastFace ? subtitleEased : 0,
                willChange: "opacity, transform",
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              Are you getting it?
            </span>
          </div>
        </div>
      )}

      {/* Phase 6: iPhone arrives from bottom, icons animate in */}
      {isInPhase6 && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none"
        >
          {/* Outer wrapper: handles vertical slide-in + overall fade */}
          <div
            style={{
              transform: `translateY(${phoneSlideY}vh)`,
              opacity: phoneOverallOpacity * phase6FadeOut,
              willChange: "transform, opacity",
              flexShrink: 0,
            }}
          >
            {/* Inner wrapper: fixed 391×746 dimensions + scale */}
            <div
              style={{
                width: 391,
                height: 746,
                transform: `scale(${phoneScale})`,
                transformOrigin: "center center",
                flexShrink: 0,
              }}
            >
              <Group4 />
            </div>
          </div>
        </div>
      )}

      {/* Phase 7: Hand + Absorption Animation (after icons animation done) */}
      {isInPhase7 && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none"
        >
          {/* Absorption animation */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: phase7Text2Visible ? 0 : absorptionFadeProgress * 0.2,
              transition: "opacity 0.6s ease-out",
              willChange: "opacity",
              zIndex: 1,
            }}
          >
            <AbsorptionAnimation particleColor="0, 0, 0" showBackground={false} />
          </div>

          {/* Hand slide-up + swipe → slide-down exit */}
          {phase7HandSmooth > 0 && !phase7HandExit && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: `translate(calc(-50% + clamp(80px, 15vw, 150px)), ${(1 - phase7HandSmooth) * 100}%)`,
              opacity: phase7HandSmooth,
              willChange: "transform, opacity",
              zIndex: 4,
            }}
          >
            <div
              style={{
                animation: phase7SwipeTriggered ? "handSwipeLeft 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards" : "none",
              }}
            >
              <img src={handImg} alt="Hand" draggable={false} style={{ width: "clamp(200px, 40vw, 400px)", height: "auto", display: "block", objectFit: "contain" }} />
            </div>
          </div>
          )}
          {phase7HandExit && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              animation: "handSlideDown 0.8s cubic-bezier(0.55, 0.06, 0.68, 0.19) forwards",
              willChange: "transform, opacity",
              zIndex: 4,
            }}
          >
              <img src={handImg} alt="Hand" draggable={false} style={{ width: "clamp(200px, 40vw, 400px)", height: "auto", display: "block", objectFit: "contain" }} />
          </div>
          )}

          {/* Phase 7 text 1: word-by-word reveal (scroll-driven) — fades out when hand exits */}
          {phase7Progress > phase7WordRevealStart && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 3,
                padding: "0 clamp(16px, 4vw, 48px)",
                opacity: phase7HandExit ? 0 : 1,
                transition: "opacity 0.6s ease-out",
              }}
            >
              <p
                style={{
                  textAlign: "center",
                  maxWidth: "800px",
                  fontSize: "clamp(1.6rem, 4vw, 3rem)",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.3,
                  color: "black",
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "center",
                  gap: "0 0.35em",
                }}
              >
                {phase7Text1Words.map((word, i) => {
                  const wp = getPhase7WordProgress(i);
                  const blur = 50 * (1 - wp);
                  const ty = 30 * (1 - wp);
                  return (
                    <span
                      key={i}
                      style={{
                        display: "inline-block",
                        opacity: wp,
                        filter: `blur(${blur}px)`,
                        transform: `translateY(${ty}px)`,
                        willChange: "opacity, filter, transform",
                      }}
                    >
                      {word}
                    </span>
                  );
                })}
              </p>
            </div>
          )}

          {/* Phase 7 text 2: slides in from the right */}
          {phase7Text2Visible && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                zIndex: 3,
                padding: "0 clamp(16px, 4vw, 48px)",
                opacity: 0,
                animation: "phase7Text2SlideIn 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.3s forwards",
              }}
            >
              <p
                style={{
                  textAlign: "center",
                  maxWidth: "800px",
                  fontSize: "clamp(1.6rem, 4vw, 3rem)",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.3,
                  color: "black",
                }}
              >
                These are not three separate devices. This is one device. And we are calling it iPhone.
              </p>
              {/* Signature with animated reveal */}
              <div
                style={{
                  position: "relative",
                  marginTop: "clamp(24px, 4vh, 48px)",
                  width: "clamp(180px, 30vw, 320px)",
                }}
              >
                <img
                  src={signatureImg}
                  alt="Steve Jobs signature"
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "auto",
                    display: "block",
                  }}
                />
                {/* White overlay that shrinks from left to right to reveal signature */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    bottom: 0,
                    width: "100%",
                    backgroundColor: "white",
                    animation: "signatureReveal 2s cubic-bezier(0.25, 0.46, 0.45, 0.94) 1.2s forwards",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}