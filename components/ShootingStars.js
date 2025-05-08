// components/ShootingStars.js
'use client';

import { useEffect } from 'react';

const ShootingStars = () => {
  useEffect(() => {
    const canvas = document.getElementById('stars-canvas');
    const ctx = canvas.getContext('2d');

    // Set canvas size to full window
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Handle window resize
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Shooting star properties
    const stars = [];
    const createStar = () => {
      const angle = Math.random() * 2 * Math.PI; // Random angle in radians
      const speed = Math.random() * 3 + 1; // Slower speed range (1 to 4)
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        length: Math.random() * 60 + 20, // Slightly shorter for subtlety
        speedX: Math.cos(angle) * speed, // X-component of velocity
        speedY: Math.sin(angle) * speed, // Y-component of velocity
        opacity: Math.random() * 0.4 + 0.4, // Slightly lower opacity for subtlety
      };
    };

    // Generate stars with a delay
    let lastStarTime = 0;
    const minStarInterval = 2000; // Minimum 2 seconds between stars
    const maxStars = 3; // Reduced max stars for slower frequency

    const generateStars = () => {
      const currentTime = Date.now();
      if (stars.length < maxStars && currentTime - lastStarTime > minStarInterval) {
        stars.push(createStar());
        lastStarTime = currentTime;
      }
    };

    // Animation loop
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stars.forEach((star, index) => {
        // Draw star with gradient for glow effect
        const gradient = ctx.createLinearGradient(
          star.x,
          star.y,
          star.x + star.length * Math.cos(Math.atan2(star.speedY, star.speedX)),
          star.y + star.length * Math.sin(Math.atan2(star.speedY, star.speedX))
        );
        gradient.addColorStop(0, `rgba(255, 255, 255, ${star.opacity})`);
        gradient.addColorStop(1, `rgba(255, 255, 255, ${star.opacity * 0.2})`);

        ctx.beginPath();
        ctx.moveTo(star.x, star.y);
        ctx.lineTo(
          star.x + star.length * Math.cos(Math.atan2(star.speedY, star.speedX)),
          star.y + star.length * Math.sin(Math.atan2(star.speedY, star.speedX))
        );
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Update star position
        star.x += star.speedX;
        star.y += star.speedY;

        // Remove star if out of bounds
        if (
          star.x < -star.length ||
          star.x > canvas.width + star.length ||
          star.y < -star.length ||
          star.y > canvas.height + star.length
        ) {
          stars.splice(index, 1);
        }
      });

      generateStars();
      requestAnimationFrame(animate);
    };

    animate();

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      id="stars-canvas"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
        pointerEvents: 'none',
      }}
    />
  );
};

export default ShootingStars;