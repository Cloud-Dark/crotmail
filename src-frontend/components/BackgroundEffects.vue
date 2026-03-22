<script setup>
</script>

<template>
  <div class="fixed inset-0 pointer-events-none overflow-hidden -z-10">
    <!-- Gradient background -->
    <div class="absolute inset-0 bg-gradient-to-br from-primary-950/30 via-dark-950 to-accent-950/20" />
    
    <!-- Grid -->
    <div 
      class="absolute inset-0 opacity-30"
      style="
        background-image: 
          linear-gradient(rgba(139, 92, 246, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(139, 92, 246, 0.03) 1px, transparent 1px);
        background-size: 60px 60px;
        mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, black 20%, transparent 70%);
      "
    />
    
    <!-- Glow -->
    <div class="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-primary-500/10 blur-[100px] animate-float" />
    <div class="absolute top-1/3 -right-20 w-[400px] h-[400px] rounded-full bg-accent-500/10 blur-[80px] animate-float" style="animation-delay: -8s" />
    <div class="absolute -bottom-20 left-1/3 w-[350px] h-[350px] rounded-full bg-cyan-500/5 blur-[100px] animate-float" style="animation-delay: -16s" />
    
    <!-- Noise -->
    <div 
      class="absolute inset-0 opacity-[0.015]"
      style="background-image: url('data:image/svg+xml,%3Csvg viewBox=%220 0 256 256%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noise%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noise)%22/%3E%3C/svg%3E')"
    />
  </div>
</template>
