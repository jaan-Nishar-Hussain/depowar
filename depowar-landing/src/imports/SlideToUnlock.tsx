import svgPaths from "./svg-lrkih46fki";

function ArrowButton({ className }: { className?: string }) {
  return (
    <div className={className || "h-[47px] overflow-clip relative rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.25)] w-[68px]"} data-name="Arrow button" style={{ backgroundImage: "linear-gradient(rgb(240, 240, 240) 0%, rgb(240, 240, 240) 21.348%, rgb(224, 224, 224) 47.551%, rgb(207, 207, 207) 47.588%, rgb(175, 175, 175) 100%)" }}>
      <div className="absolute h-[23.383px] left-[20px] top-[12px] w-[30px]" data-name="Arrow button">
        <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 30 23.3828">
          <g id="Arrow button">
            <path d={svgPaths.p271850f0} fill="var(--fill-0, #8C8C8C)" id="Arrow button icon" style={{ fill: "color(display-p3 0.5490 0.5490 0.5490)", fillOpacity: "1" }} />
          </g>
        </svg>
      </div>
    </div>
  );
}

export default function SlideToUnlock({ className }: { className?: string }) {
  return (
    <div className={className || "border border-[#505050] border-solid h-[53px] overflow-clip relative rounded-[12px] w-[279px]"} data-name="Slide to unlock" style={{ backgroundImage: "linear-gradient(179.502deg, rgb(0, 0, 0) 2.1886%, rgba(0, 0, 0, 0.59) 63.6%, rgba(0, 0, 0, 0) 105.94%)" }}>
      <ArrowButton className="absolute h-[47px] left-[2px] overflow-clip rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.25)] top-[2px] w-[68px]" />
      <div className="-translate-y-1/2 absolute bg-clip-text flex flex-col font-['SF_Pro_Text:Semibold',sans-serif] justify-center leading-[0] left-[103px] not-italic text-[21px] text-[transparent] top-[25.5px] tracking-[-0.21px] whitespace-nowrap" style={{ backgroundImage: "linear-gradient(-90deg, rgba(254, 254, 254, 0.4) 0%, rgba(254, 254, 254, 0.93) 35.722%, rgb(254, 254, 254) 54.386%, rgba(254, 254, 254, 0.824) 77.298%, rgba(254, 254, 254, 0.4) 101.72%)" }}>
        <p className="leading-[normal]">slide to unlock</p>
      </div>
    </div>
  );
}