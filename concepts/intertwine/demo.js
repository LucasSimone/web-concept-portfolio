document.addEventListener('DOMContentLoaded', () => {
  gsap.registerPlugin(ScrollTrigger);

  const stage = document.querySelector('.intertwine-stage');
  const paths = gsap.utils.toArray('.intertwine-path');
  const progressValue = document.getElementById('progressValue');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  paths.forEach((path) => {
    const length = path.getTotalLength();

    gsap.set(path, {
      strokeDasharray: length,
      strokeDashoffset: length,
    });
  });

  if (reduceMotion) {
    gsap.set(paths, { strokeDashoffset: 0 });
    progressValue.textContent = '100%';
    return;
  }

  const drawProgress = { value: 0 };

  gsap.timeline({
    scrollTrigger: {
      trigger: stage,
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
      pin: '.intertwine-art',
      onUpdate: (self) => {
        progressValue.textContent = `${Math.round(self.progress * 100)
          .toString()
          .padStart(2, '0')}%`;
      },
    },
  })
    .to(drawProgress, {
      value: 1,
      duration: 1,
      ease: 'none',
      onUpdate: () => {
        paths.forEach((path, index) => {
          const length = path.getTotalLength();
          const delay = index === 0 ? 0 : 0.1;
          const pathProgress = Math.max(0, Math.min(1, drawProgress.value - delay));
          path.style.strokeDashoffset = length * (1 - pathProgress);
        });
      },
    });
});
