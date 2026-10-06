/* ============================================================================
 *  mc/playerphysics.js
 *  ---------------------------------------------------------------------------
 *  Reproduction EXACTE du système de mouvement, de caméra et d'animation du
 *  joueur de Minecraft Java Edition.
 *
 *  Chaque constante et chaque formule ci-dessous est reprise du code source du
 *  jeu (décompilé / mappages Yarn-MCP) ou de son port de référence
 *  PrismarineJS. Les fichiers d'origine sont indiqués à côté de chaque valeur :
 *
 *    - net/minecraft/entity/LivingEntity.java      -> travel(), getRelevantMoveFactor(),
 *                                                     jump(), func_233629_a_ (limb swing)
 *    - net/minecraft/entity/Entity.java            -> move(), getAllowedMovement(),
 *                                                     collideBoundingBox(), getAbsoluteMotion(),
 *                                                     distanceWalkedModified
 *    - net/minecraft/entity/player/PlayerEntity.java -> maybeBackOffFromEdge(), travel() (vol),
 *                                                     getStandingEyeHeight(), cameraYaw
 *    - net/minecraft/client/network/AbstractClientPlayerEntity.java -> getFovModifier()
 *    - net/minecraft/client/renderer/GameRenderer.java -> applyBobbing(), hurtCameraEffect(),
 *                                                     updateFovModifierHand(), getFOVModifier()
 *    - net/minecraft/client/renderer/ActiveRenderInfo.java -> interpolateHeight()
 *    - net/minecraft/client/renderer/entity/model/BipedModel.java -> setRotationAngles()
 *    - PrismarineJS/prismarine-physics (index.js, lib/*.js) : port de référence validé
 *      tick par tick contre un vrai client.
 *
 *  Unités : 1 bloc = 1 mètre, les vitesses sont en blocs par TICK (1 tick = 1/20 s).
 *  Convention d'angle : yaw en radians, yaw = 0 => le joueur regarde vers +Z
 *  (comme dans Minecraft Java : `/tp ~ ~ ~ 0 0` oriente vers le sud).
 *
 *  Le module est volontairement sans dépendance (ni THREE, ni autre) pour
 *  pouvoir être testé dans Node et réutilisé ailleurs.
 * ==========================================================================*/
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MCPhys = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* ==========================================================================
   * 1. CONSTANTES OFFICIELLES
   * ==========================================================================*/

  const MC = {
    /* --- Horloge du jeu ---------------------------------------------------- */
    TPS: 20,                    // le jeu simule exactement 20 ticks par seconde
    TICK_DT: 0.05,              // durée d'un tick en secondes (1/20)

    /* --- Physique verticale (LivingEntity.travel : double d0 = 0.08D) ------- */
    GRAVITY: 0.08,              // blocs/tick²   -> 32 m/s²
    GRAVITY_DRAG: 0.98,         // motionY *= 0.98 (Entity)
    TERMINAL_VELOCITY: 3.92,    // vitesse de chute maximale = 0.08*0.98/(1-0.98)
    SLOW_FALLING_GRAVITY: 0.01, // effet Chute lente (travel : d0 = 0.01D)

    /* --- Friction / inertie ------------------------------------------------ */
    FRICTION: 0.91,             // en l'air : motionX *= 0.91
    DEFAULT_SLIPPERINESS: 0.6,  // glissance d'un bloc normal (Block.slipperiness)
    /* Au sol : friction = glissance * 0.91 (0.546 pour un bloc normal) */
    SLIPPERINESS: {
      ice: 0.98, packed_ice: 0.98, frosted_ice: 0.98, blue_ice: 0.989,
      slime_block: 0.8,
      // tous les autres blocs : 0.6 (DEFAULT_SLIPPERINESS)
    },

    /* --- Accélération au sol (LivingEntity.getRelevantMoveFactor) ----------
     * accel = vitesseAttribut * (0.21600002 / glissance³)
     * 0.21600002 = 0.6³, donc sur un bloc normal le facteur vaut exactement 1
     * et l'accélération est égale à l'attribut movement_speed (0.1).          */
    GROUND_ACCEL_FACTOR: 0.21600002,

    /* --- Attributs du joueur ---------------------------------------------- */
    BASE_MOVE_SPEED: 0.1,       // minecraft:generic.movement_speed (blocs/tick)
    SPRINT_MODIFIER: 0.3,       // modificateur de sprint : opération 2 (x1,3)
    SNEAK_INPUT_SCALE: 0.3,     // s'accroupir : entrée * 0,3 (MovementInput)
    INPUT_SCALE: 0.98,          // MovementInput : moveForward/moveStrafe *= 0,98

    /* --- Mouvement dans les airs (LivingEntity.jumpMovementFactor) --------- */
    AIR_ACCEL: 0.02,            // en l'air, la touche de déplacement accélère de 0,02
    AIR_ACCEL_SPRINT_BONUS: 0.006, // +0,006 en sprint -> 0,026 (PlayerEntity.tick)

    /* --- Saut (LivingEntity.jump / getJumpUpwardsMotion) ------------------- */
    JUMP_VELOCITY: 0.42,        // blocs/tick = 8,4 m/s -> hauteur 1,2522 blocs
    JUMP_BOOST_PER_LEVEL: 0.1,  // effet Saut amélioré : +0,1 par niveau
    JUMP_TICKS: 10,             // délai avant le saut suivant (0,5 s)
    SPRINT_JUMP_IMPULSE: 0.2,   // impulsion horizontale supplémentaire en sprint

    /* --- Bloc / collision (Entity / PlayerEntity) -------------------------- */
    WIDTH: 0.6,                 // largeur de la boîte du joueur
    HALF_WIDTH: 0.3,
    HEIGHT: 1.8,                // debout
    HEIGHT_SNEAK: 1.5,          // accroupi (Pose.CROUCHING)
    HEIGHT_SWIM: 0.6,           // nage / vol en élytres (Pose.SWIMMING)
    STEP_HEIGHT: 0.6,           // hauteur de marche franchissable sans sauter
    NEGligible_VELOCITY: 0.003, // en dessous, la vitesse est remise à zéro

    /* --- Hauteur des yeux (PlayerEntity.getStandingEyeHeight) -------------- */
    EYE_HEIGHT: 1.62,           // debout
    EYE_HEIGHT_SNEAK: 1.27,     // accroupi
    EYE_HEIGHT_SWIM: 0.4,       // nage / vol en élytres / attaque tournoyante
    EYE_SMOOTHING: 0.5,         // ActiveRenderInfo.interpolateHeight() : lissage

    /* --- Liquides (LivingEntity.travel) ------------------------------------ */
    WATER_INERTIA: 0.8,         // vitesse d'eau : motion *= 0,8
    WATER_DRAG_Y: 0.8,          // sur Y : *= 0,8
    WATER_ACCEL: 0.02,
    WATER_SPRINT_INERTIA: 0.9,  // en sprint : 0,9 au lieu de 0,8
    LAVA_INERTIA: 0.5,
    LAVA_DRAG_Y: 0.8,
    LAVA_ACCEL: 0.02,
    FLUID_JUMP_THRESHOLD: 0.4,  // LivingEntity.getFluidJumpThreshold()
    FLUID_JUMP_VELOCITY: 0.04,  // « nager » vers le haut dans un liquide
    FLUID_GRAVITY_DIV: 16,      // gravité dans l'eau = 0,08 / 16 = 0,005
    LAVA_GRAVITY_DIV: 4,        // dans la lave : -0,08 / 4 = -0,02 en plus

    /* --- Échelles / lianes (LivingEntity.handleOnClimbable) ---------------- */
    LADDER_MAX_SPEED: 0.15,     // vitesse horizontale ET descente limitée
    LADDER_CLIMB_SPEED: 0.2,    // montée

    /* --- Vol créatif (PlayerEntity.travel + ClientPlayerEntity) ------------ */
    FLY_SPEED: 0.05,            // PlayerAbilities.flySpeed
    FLY_SPRINT_MULTIPLIER: 2,   // en sprint, l'accélération est doublée
    FLY_VERTICAL_MULTIPLIER: 3, // monter/descendre : 3 × la vitesse de vol
    FLY_VERTICAL_DRAG: 0.6,     // motionY de début de tick, amorti

    /* --- Caméra : champ de vision (GameRenderer / AbstractClientPlayer) ---- */
    DEFAULT_FOV: 70,            // FOV par défaut de Minecraft
    FOV_FLYING_MULTIPLIER: 1.1, // en vol : × 1,1
    FOV_SMOOTHING: 0.5,         // fovModifierHand += (f - fovModifierHand) * 0,5
    FOV_MIN: 0.1,
    FOV_MAX: 1.5,

    /* --- Caméra : balancement (GameRenderer.applyBobbing) ------------------ */
    BOB_X_AMPLITUDE: 0.5,
    BOB_Y_AMPLITUDE: 1.0,
    BOB_ROLL_AMPLITUDE: 3.0,    // degrés
    BOB_PITCH_AMPLITUDE: 5.0,   // degrés
    BOB_PITCH_OFFSET: 0.2,

    /* --- Caméra : inclination quand on prend des dégâts -------------------- */
    HURT_MAX_TIME: 10,          // LivingEntity.maxHurtTime
    HURT_ROLL_DEGREES: 14,

    /* --- Animation des membres (BipedModel.setRotationAngles) -------------- */
    LIMB_SWING_FREQUENCY: 0.6662,
    LIMB_LEG_AMPLITUDE: 1.4,
    LIMB_ARM_AMPLITUDE: 2.0,
    LIMB_ARM_SCALE: 0.5,
    LIMB_SWING_SMOOTHING: 0.4,  // limbSwingAmount += (cible - actuel) * 0,4
    LIMB_SWING_SCALE: 4.0,      // distance parcourue * 4, plafonnée à 1
    SWING_DURATION_TICKS: 6,    // animation d'attaque (LivingEntity.getArmSwingAnimationEnd)
    SWIM_LEG_FREQUENCY: 0.33333334,
    SWIM_LEG_AMPLITUDE: 0.3,

    /* --- Balancement de caméra lié à la vitesse (PlayerEntity.cameraYaw) --- */
    CAMERA_YAW_MAX: 0.1,
    CAMERA_YAW_SMOOTHING: 0.4,
  };

  /* ==========================================================================
   * 2. OUTILS
   * ==========================================================================*/

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const DEG = Math.PI / 180;
  const EPS = 1e-7;

  /** Boîte alignée sur les axes (AxisAlignedBB). */
  function aabb (minX, minY, minZ, maxX, maxY, maxZ) {
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }
  const aabbOffset = (b, x, y, z) =>
    aabb(b.minX + x, b.minY + y, b.minZ + z, b.maxX + x, b.maxY + y, b.maxZ + z);
  /** Agrandit la boîte dans le sens du déplacement (AxisAlignedBB.expand). */
  function aabbExpand (b, x, y, z) {
    return aabb(
      x < 0 ? b.minX + x : b.minX, y < 0 ? b.minY + y : b.minY, z < 0 ? b.minZ + z : b.minZ,
      x > 0 ? b.maxX + x : b.maxX, y > 0 ? b.maxY + y : b.maxY, z > 0 ? b.maxZ + z : b.maxZ);
  }
  function aabbGrow (b, x, y, z) {
    return aabb(b.minX - x, b.minY - y, b.minZ - z, b.maxX + x, b.maxY + y, b.maxZ + z);
  }

  /* Les trois fonctions suivantes reproduisent AxisAlignedBB.calculateXOffset /
   * calculateYOffset / calculateZOffset (VoxelShapes.getAllowedOffset).
   * Comme dans le jeu, `box` est la boîte du BLOC (this) et `bb` celle du
   * JOUEUR en mouvement (l'argument) : pour un déplacement positif le bloc
   * doit être entièrement « devant » la boîte du joueur. */
  function offsetX (box, bb, dx) {
    if (bb.maxY > box.minY && bb.minY < box.maxY && bb.maxZ > box.minZ && bb.minZ < box.maxZ) {
      if (dx > 0 && bb.maxX <= box.minX) dx = Math.min(box.minX - bb.maxX, dx);
      else if (dx < 0 && bb.minX >= box.maxX) dx = Math.max(box.maxX - bb.minX, dx);
    }
    return dx;
  }
  function offsetY (box, bb, dy) {
    if (bb.maxX > box.minX && bb.minX < box.maxX && bb.maxZ > box.minZ && bb.minZ < box.maxZ) {
      if (dy > 0 && bb.maxY <= box.minY) dy = Math.min(box.minY - bb.maxY, dy);
      else if (dy < 0 && bb.minY >= box.maxY) dy = Math.max(box.maxY - bb.minY, dy);
    }
    return dy;
  }
  function offsetZ (box, bb, dz) {
    if (bb.maxX > box.minX && bb.minX < box.maxX && bb.maxY > box.minY && bb.minY < box.maxY) {
      if (dz > 0 && bb.maxZ <= box.minZ) dz = Math.min(box.minZ - bb.maxZ, dz);
      else if (dz < 0 && bb.minZ >= box.maxZ) dz = Math.max(box.maxZ - bb.minZ, dz);
    }
    return dz;
  }
  /** VoxelShapes.getAllowedOffset : applique toutes les boîtes sur un axe. */
  function maxOffset (axis, boxes, bb, d) {
    if (d === 0) return 0;
    for (const box of boxes) {
      if (Math.abs(d) < EPS) return 0;
      d = axis === 0 ? offsetX(box, bb, d) : axis === 1 ? offsetY(box, bb, d) : offsetZ(box, bb, d);
    }
    return d;
  }

  /* ==========================================================================
   * 3. JOUEUR
   * ==========================================================================*/

  class MCPlayer {
    constructor (opts) {
      opts = opts || {};
      /* --- Position / vitesse (pos = pieds du joueur) --- */
      this.pos = { x: 0, y: 0, z: 0 };
      this.prevPos = { x: 0, y: 0, z: 0 };
      this.vel = { x: 0, y: 0, z: 0 };
      this.yaw = 0;                 // radians, convention Minecraft (0 = +Z)
      this.pitch = 0;               // radians, positif = regard vers le bas
      this.prevYaw = 0;
      this.prevPitch = 0;

      /* --- État --- */
      this.onGround = false;
      this.isSprinting = false;
      this.isSneaking = false;
      this.isFlying = false;        // vol créatif
      this.isGliding = false;       // élytres
      this.isSwimming = false;
      this.isInWater = false;
      this.isInLava = false;
      this.fluidHeight = 0;         // hauteur de liquide au-dessus des pieds
      this.isClimbing = false;
      this.jumpTicks = 0;           // cooldown du saut (10 ticks)
      this.jumpQueued = false;      // autojump / file d'attente
      this.fallDistance = 0;
      this.ticksExisted = 0;
      this.dead = false;
      this.deathTime = 0;
      this.noClip = false;

      /* --- Entrées (MovementInput) --- */
      this.input = {
        forward: false, back: false, left: false, right: false,
        jump: false, sneak: false, sprint: false,
      };

      /* --- Capacités (PlayerAbilities) --- */
      this.abilities = {
        walkSpeed: MC.BASE_MOVE_SPEED,  // dénominateur du calcul de FOV
        flySpeed: MC.FLY_SPEED,
        allowFlying: false,
        invulnerable: false,
      };
      /* Modificateurs de l'attribut movement_speed (effets Vitesse, lenteur…) */
      this.speedModifiers = [];        // [{amount, operation}] (opération 0/1/2)
      this.jumpBoost = 0;              // niveau de l'effet Saut amélioré
      this.levitation = 0;             // niveau de l'effet Lévitation
      this.slowFalling = false;
      this.depthStrider = 0;
      this.dolphinsGrace = false;

      /* --- Rendu / caméra --- */
      this.pose = 'standing';
      this.eyeHeight = MC.EYE_HEIGHT;         // hauteur d'œil lissée (rendu)
      this.fovMultiplier = 1;                 // lissé (updateFovModifierHand)
      this.fovMultiplierPrev = 1;
      this.hurtTime = 0;
      this.maxHurtTime = MC.HURT_MAX_TIME;
      this.attackedAtYaw = 0;                 // yaw de l'attaque (degrés)

      /* --- Animation (LivingEntity.func_233629_a_ + PlayerEntity.cameraYaw) --- */
      this.limbSwing = 0;
      this.limbSwingAmount = 0;
      this.prevLimbSwingAmount = 0;
      this.cameraYaw = 0;
      this.prevCameraYaw = 0;
      this.distanceWalkedModified = 0;
      this.prevDistanceWalkedModified = 0;
      this.swingProgress = 0;                 // animation d'attaque (0→1)
      this.swingProgressInt = 0;
      this.isSwingInProgress = false;

      /* --- Sorties de diagnostic (debug F3) --- */
      this.stats = {
        slipperiness: MC.DEFAULT_SLIPPERINESS,
        friction: MC.DEFAULT_SLIPPERINESS * MC.FRICTION,
        acceleration: 0,
        speedAttribute: MC.BASE_MOVE_SPEED,
        moveSpeed: 0,      // blocs/seconde (mesuré sur le tick)
        tick: 0,
      };

      this.world = opts.world || null;
    }

    /* ----------------------------------------------------------------------
     * Dimensions / pose
     * -------------------------------------------------------------------- */

    /** Pose courante : standing | crouching | swimming | gliding. */
    getPose () {
      if (this.isGliding) return 'gliding';
      if (this.isSwimming) return 'swimming';
      if (this.isSneaking && !this.isFlying) return 'crouching';
      return 'standing';
    }
    /** Hauteur de la boîte de collision selon la pose (EntitySize). */
    getHeight () {
      const p = this.getPose();
      if (p === 'crouching') return MC.HEIGHT_SNEAK;
      if (p === 'swimming' || p === 'gliding') return MC.HEIGHT_SWIM;
      return MC.HEIGHT;
    }
    /** Hauteur des yeux (PlayerEntity.getStandingEyeHeight). */
    getEyeHeightFor (pose) {
      switch (pose || this.getPose()) {
        case 'swimming':
        case 'gliding': return MC.EYE_HEIGHT_SWIM;
        case 'crouching': return MC.EYE_HEIGHT_SNEAK;
        default: return MC.EYE_HEIGHT;
      }
    }
    /** Boîte de collision courante (Entity.getBoundingBox). */
    getBoundingBox () {
      const h = this.getHeight(), w = MC.HALF_WIDTH;
      return aabb(this.pos.x - w, this.pos.y, this.pos.z - w,
                  this.pos.x + w, this.pos.y + h, this.pos.z + w);
    }
    /** Vecteur regard (Entity.getVectorForRotation). */
    getLookVec () {
      const f = this.pitch, f1 = -this.yaw;
      const cp = Math.cos(f);
      return { x: Math.sin(f1) * cp, y: -Math.sin(f), z: Math.cos(f1) * cp };
    }
    /** Valeur de l'attribut movement_speed (avec sprint + effets). */
    getMoveSpeedAttribute () {
      // LivingEntity.getAttributeValue : op0 (addition) puis op1 puis op2 (multiplication)
      let x = MC.BASE_MOVE_SPEED;
      for (const m of this.speedModifiers) if (m.operation === 0) x += m.amount;
      let y = x;
      for (const m of this.speedModifiers) if (m.operation === 1) y += x * m.amount;
      for (const m of this.speedModifiers) if (m.operation === 2) y += y * m.amount;
      if (this.isSprinting) y += y * MC.SPRINT_MODIFIER;
      return y;
    }
    /** Accélération au sol : getAIMoveSpeed * (0.21600002 / glissance³). */
    getRelevantMoveFactor (slipperiness) {
      return this.getMoveSpeedAttribute() *
        (MC.GROUND_ACCEL_FACTOR / (slipperiness * slipperiness * slipperiness));
    }
    /** Accélération dans les airs (LivingEntity.jumpMovementFactor). */
    getJumpMovementFactor () {
      return this.isSprinting
        ? MC.AIR_ACCEL + MC.AIR_ACCEL_SPRINT_BONUS   // 0,026
        : MC.AIR_ACCEL;                              // 0,02
    }

    /* ----------------------------------------------------------------------
     * Entrées
     * -------------------------------------------------------------------- */

    /** MovementInput : les touches deviennent un vecteur (strafe, 0, forward). */
    getMovementInput () {
      let strafe = (this.input.left ? 1 : 0) - (this.input.right ? 1 : 0);
      let forward = (this.input.forward ? 1 : 0) - (this.input.back ? 1 : 0);
      strafe *= MC.INPUT_SCALE;          // 0,98
      forward *= MC.INPUT_SCALE;         // 0,98
      if (this.isSneaking && !this.isFlying) {
        strafe *= MC.SNEAK_INPUT_SCALE;  // 0,3
        forward *= MC.SNEAK_INPUT_SCALE;
      }
      return { x: strafe, y: 0, z: forward };
    }

    /* ----------------------------------------------------------------------
     * Boucle de tick (20 fois par seconde)
     * -------------------------------------------------------------------- */

    /**
     * Simule un tick complet (1/20 s).
     * Ordre repris de LivingEntity.tick() -> livingTick() -> travel().
     */
    tick (world) {
      world = world || this.world;
      this.prevPos.x = this.pos.x; this.prevPos.y = this.pos.y; this.prevPos.z = this.pos.z;
      this.prevYaw = this.yaw; this.prevPitch = this.pitch;
      this.prevLimbSwingAmount = this.limbSwingAmount;
      this.prevCameraYaw = this.cameraYaw;
      this.prevDistanceWalkedModified = this.distanceWalkedModified;
      this.fovMultiplierPrev = this.fovMultiplier;

      this.pose = this.getPose();

      if (this.hurtTime > 0) this.hurtTime--;
      if (this.dead) this.deathTime++; else this.deathTime = 0;

      /* --- 1. État des liquides (Entity.updateFluidHeightAndDoFluidPushing) */
      this.updateFluidState(world);

      /* --- 2. Vivant ? --- */
      if (this.dead) {
        /* Le corps retombe (gravité) mais ne répond plus aux touches. */
        this.vel.x = 0; this.vel.z = 0;
        this.vel.y = (this.vel.y - MC.GRAVITY) * MC.GRAVITY_DRAG;
        this.move(world, 0, this.vel.y, 0);
        this.ticksExisted++; return;
      }

      /* --- 3. Cooldown du saut (LivingEntity.livingTick) --- */
      if (this.jumpTicks > 0) this.jumpTicks--;

      /* --- 4. Sprint (ClientPlayerEntity.livingTick / LocalPlayer.aiStep) --- */
      this.updateSprinting();

      this.isSneaking = !!this.input.sneak && !this.isFlying;
      if (this.isFlying) this.isSneaking = false;

      /* --- 5. Saut (LivingEntity.livingTick) --- */
      this.handleJump();

      /* --- 6. Déplacement (PlayerEntity.travel -> LivingEntity.travel) --- */
      this.travel(world, this.getMovementInput());

      /* --- 7. Animation des membres (fin de travel) --- */
      this.updateLimbs();

      /* --- 8. Balancement de caméra (PlayerEntity.tick) --- */
      const f = (this.onGround && !this.dead && !this.isSwimming)
        ? Math.min(MC.CAMERA_YAW_MAX, Math.hypot(this.vel.x, this.vel.z))
        : 0;
      this.cameraYaw += (f - this.cameraYaw) * MC.CAMERA_YAW_SMOOTHING;

      /* --- 9. Animation d'attaque (LivingEntity.updateArmSwingProgress) --- */
      this.updateArmSwing();

      /* --- 10. Champ de vision dynamique (GameRenderer.updateFovModifierHand) */
      this.fovMultiplier = clamp(
        this.fovMultiplier + (this.getFovModifierRaw() - this.fovMultiplier) * MC.FOV_SMOOTHING,
        MC.FOV_MIN, MC.FOV_MAX);

      this.ticksExisted++;
      this.stats.tick = this.ticksExisted;
    }

    /** Entity.updateFluidHeightAndDoFluidPushing (simplifié au joueur). */
    updateFluidState (world) {
      if (!world || !world.getFluid) { this.isInWater = this.isInLava = false; this.fluidHeight = 0; return; }
      const bb = aabbGrow(this.getBoundingBox(), -0.001, -0.001, -0.001);
      const f = world.getFluid(bb) || {};
      this.isInWater = !!f.water;
      this.isInLava = !!f.lava;
      this.fluidHeight = f.height || 0;
      this.isSwimming = this.isInWater && this.fluidHeight > MC.FLUID_JUMP_THRESHOLD;
      if (!this.isInWater && !this.isInLava) this.fluidHeight = 0;
    }

    /**
     * Sprint : démarrage avec de l'élan vers l'avant, arrêt dès qu'on
     * n'avance plus, qu'on est accroupi ou qu'on touche un mur.
     * (ClientPlayerEntity.livingTick / LocalPlayer.aiStep)
     */
    updateSprinting () {
      const inp = this.input;
      const movingForward = inp.forward && !inp.back;
      // Le vol créatif permet de sprinter sans faim ni élan
      if (this.isFlying) { this.isSprinting = !!inp.sprint; return; }
      if (!inp.sprint) { this.isSprinting = false; return; }
      if (!this.isSprinting && movingForward && !inp.sneak) this.isSprinting = true;
      if (this.isSprinting) {
        if (!movingForward || this.collidedHorizontally || (this.isInWater && !this.isSwimming)) {
          this.isSprinting = false;
        }
      }
    }

    /** LivingEntity.livingTick : déclenchement du saut. */
    handleJump () {
      const wantsJump = this.input.jump || this.jumpQueued;
      if (!wantsJump || this.isFlying) { this.jumpTicks = 0; this.jumpQueued = false; return; }
      if (this.isInWater || this.isInLava) {
        // nager vers la surface
        this.vel.y += MC.FLUID_JUMP_VELOCITY;
        this.jumpQueued = false;
      } else if (this.onGround && this.jumpTicks === 0) {
        this.jump();
        this.jumpTicks = MC.JUMP_TICKS;
      }
      this.jumpQueued = false;
    }

    /** LivingEntity.jump() : 0,42 + bonus + impulsion de sprint. */
    jump () {
      let f = MC.JUMP_VELOCITY;
      if (this.jumpBoost > 0) f += MC.JUMP_BOOST_PER_LEVEL * this.jumpBoost;
      this.vel.y = f;
      if (this.isSprinting) {
        // setMotion(add(-sin(yaw) * 0.2, 0, cos(yaw) * 0.2))
        this.vel.x -= Math.sin(this.yaw) * MC.SPRINT_JUMP_IMPULSE;
        this.vel.z += Math.cos(this.yaw) * MC.SPRINT_JUMP_IMPULSE;
      }
      /* LivingEntity.jump() ne fait que lever le flag isAirBorne : la pose
       * reste « au sol » pour ce tick, donc le saut bénéficie encore de
       * l'accélération du sol (comportement exact du jeu). */
      this.isAirBorne = true;
    }

    /* ----------------------------------------------------------------------
     * Déplacement : PlayerEntity.travel -> LivingEntity.travel
     * -------------------------------------------------------------------- */

    travel (world, input) {
      const vel = this.vel;
      this.isClimbing = !!(world && world.isClimbable && this.onGround !== null &&
        world.isClimbable(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)));

      /* --- Vol créatif : montée / descente (ClientPlayerEntity.livingTick) --- */
      if (this.isFlying && !this.isInWater) {
        const j = (this.input.jump ? 1 : 0) - (this.input.sneak ? 1 : 0);
        if (j !== 0) vel.y += j * this.abilities.flySpeed * MC.FLY_VERTICAL_MULTIPLIER;
      }

      /* --- Vitesses négligeables remises à zéro --- */
      if (Math.abs(vel.x) < MC.NEGligible_VELOCITY) vel.x = 0;
      if (Math.abs(vel.y) < MC.NEGligible_VELOCITY) vel.y = 0;
      if (Math.abs(vel.z) < MC.NEGligible_VELOCITY) vel.z = 0;

      /* --- Nage dans l'eau : le joueur suit le regard (PlayerEntity.travel) */
      if (this.isSwimming && !this.isFlying) {
        const lookY = this.getLookVec().y;
        const d4 = lookY < -0.2 ? 0.085 : 0.06;
        if (lookY <= 0 || this.input.jump) vel.y += (lookY - vel.y) * d4;
      }

      const flightEntryVelY = vel.y;

      /* --- Branches de déplacement --- */
      if (this.isFlying) {
        /* PlayerEntity.travel : jumpMovementFactor prend la vitesse de vol,
         * puis super.travel() est appelé (qui utilisera l'accélération du sol
         * si le joueur touche terre) et la vitesse verticale est restaurée. */
        const flyAccel = this.abilities.flySpeed * (this.isSprinting ? MC.FLY_SPRINT_MULTIPLIER : 1);
        this.travelNormal(world, input, flyAccel);
        this.vel.y = flightEntryVelY * MC.FLY_VERTICAL_DRAG;
        this.fallDistance = 0;
      } else if (this.isInWater) {
        this.travelInWater(world, input);
      } else if (this.isInLava) {
        this.travelInLava(world, input);
      } else if (this.isGliding) {
        this.travelElytra(world);
      } else {
        this.travelNormal(world, input);
      }
    }

    /** Branche « normale » : sol et air (LivingEntity.travel, dernier else). */
    travelNormal (world, input, flyAccel, flyInertia) {
      const vel = this.vel;
      const slip = (world && world.getSlipperiness)
        ? world.getSlipperiness(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.5), Math.floor(this.pos.z))
        : MC.DEFAULT_SLIPPERINESS;
      /* Au sol : friction = glissance × 0,91 ; en l'air (ou en vol) : 0,91.
       * (Un joueur en vol créatif qui touche le sol garde la friction du sol :
       * c'est le comportement exact de LivingEntity.travel.) */
      const inertia = this.onGround ? slip * MC.FRICTION : MC.FRICTION;
      /* Accélération : au sol -> attribut × (0,21600002 / glissance³),
       * sinon le jumpMovementFactor (0,02 / 0,026 en sprint / vitesse de vol). */
      let accel;
      if (this.onGround) accel = this.getRelevantMoveFactor(slip);
      else if (flyAccel !== undefined && flyAccel !== null) accel = flyAccel;
      else accel = this.getJumpMovementFactor();
      void flyInertia;

      this.stats.slipperiness = slip;
      this.stats.friction = inertia;
      this.stats.acceleration = accel;
      this.stats.speedAttribute = this.getMoveSpeedAttribute();

      /* applyMovementInput = moveRelative + handleOnClimbable + move */
      const moved = this.applyMovementInput(world, input, accel);

      /* Gravité */
      let d2 = moved.y;
      const gravity = this.slowFalling ? MC.SLOW_FALLING_GRAVITY : MC.GRAVITY;
      if (this.levitation > 0) {
        d2 += (0.05 * this.levitation - moved.y) * 0.2;
        this.fallDistance = 0;
      } else if (!this.isFlying) {
        d2 -= gravity;
      }
      /* motionY *= 0,98 puis friction horizontale */
      vel.y = d2 * MC.GRAVITY_DRAG;
      vel.x *= inertia;
      vel.z *= inertia;
    }

    /** LivingEntity : moveRelative + handleOnClimbable + move + échelle. */
    applyMovementInput (world, input, accel) {
      // Entity.getAbsoluteMotion : rotation de l'entrée selon le yaw
      const d0 = input.x * input.x + input.y * input.y + input.z * input.z;
      if (d0 >= 1e-7) {
        const s = d0 > 1 ? accel / Math.sqrt(d0) : accel;
        const strafe = input.x * s, forward = input.z * s;
        const f = Math.sin(this.yaw), f1 = Math.cos(this.yaw);
        this.vel.x += strafe * f1 - forward * f;
        this.vel.z += forward * f1 + strafe * f;
      }
      /* handleOnClimbable : sur une échelle, vitesse limitée et chute bloquée */
      if (this.isClimbing) {
        this.fallDistance = 0;
        const c = MC.LADDER_MAX_SPEED;
        let vy = clamp(this.vel.y, -c, c);
        if (vy < 0 && this.isSneaking) vy = 0;   // on ne descend pas en s'accrochant
        this.vel.x = clamp(this.vel.x, -c, c);
        this.vel.z = clamp(this.vel.z, -c, c);
        this.vel.y = Math.max(vy, this.isSneaking ? 0 : -c);
      }
      const before = { x: this.vel.x, y: this.vel.y, z: this.vel.z };
      this.move(world, this.vel.x, this.vel.y, this.vel.z);
      if (this.isClimbing && (this.collidedHorizontally || this.input.jump)) {
        this.vel.y = MC.LADDER_CLIMB_SPEED;      // on grimpe
      }
      void before;
      return this.vel;
    }

    /** Eau (LivingEntity.travel, branche isInWater). */
    travelInWater (world, input) {
      const vel = this.vel;
      let inertia = this.isSprinting ? MC.WATER_SPRINT_INERTIA : MC.WATER_INERTIA;
      let accel = MC.WATER_ACCEL;
      if (this.depthStrider > 0) {
        let ds = Math.min(this.depthStrider, 3);
        if (!this.onGround) ds *= 0.5;
        if (ds > 0) {
          inertia += (MC.DEFAULT_SLIPPERINESS * MC.FRICTION - inertia) * ds / 3;
          accel += (this.getMoveSpeedAttribute() - accel) * ds / 3;
        }
      }
      if (this.dolphinsGrace) inertia = 0.96;
      // moveRelative(accel) + move
      const d0 = input.x * input.x + input.z * input.z;
      if (d0 >= 1e-7) {
        const s = d0 > 1 ? accel / Math.sqrt(d0) : accel;
        const strafe = input.x * s, forward = input.z * s;
        const f = Math.sin(this.yaw), f1 = Math.cos(this.yaw);
        vel.x += strafe * f1 - forward * f;
        vel.z += forward * f1 + strafe * f;
      }
      this.move(world, vel.x, vel.y, vel.z);
      vel.x *= inertia; vel.y *= MC.WATER_DRAG_Y; vel.z *= inertia;
      // getFluidFallingAdjustedMovement : gravité / 16 avec le palier -0,003
      if (!this.isSprinting) {
        const g = MC.GRAVITY / MC.FLUID_GRAVITY_DIV;
        const falling = vel.y <= 0;
        let vy;
        if (falling && Math.abs(vel.y - 0.005) >= 0.003 && Math.abs(vel.y - g) < 0.003) vy = -0.003;
        else vy = vel.y - g;
        vel.y = vy;
      }
    }

    /** Lave (LivingEntity.travel, branche isInLava). */
    travelInLava (world, input) {
      const vel = this.vel;
      const d0 = input.x * input.x + input.z * input.z;
      if (d0 >= 1e-7) {
        const s = d0 > 1 ? MC.LAVA_ACCEL / Math.sqrt(d0) : MC.LAVA_ACCEL;
        const strafe = input.x * s, forward = input.z * s;
        const f = Math.sin(this.yaw), f1 = Math.cos(this.yaw);
        vel.x += strafe * f1 - forward * f;
        vel.z += forward * f1 + strafe * f;
      }
      this.move(world, vel.x, vel.y, vel.z);
      if (this.fluidHeight <= MC.FLUID_JUMP_THRESHOLD) {
        vel.x *= MC.LAVA_INERTIA; vel.y *= MC.LAVA_DRAG_Y; vel.z *= MC.LAVA_INERTIA;
        if (!this.isSprinting) vel.y -= MC.GRAVITY / MC.FLUID_GRAVITY_DIV;
      } else {
        vel.x *= MC.LAVA_INERTIA; vel.y *= MC.LAVA_INERTIA; vel.z *= MC.LAVA_INERTIA;
      }
      vel.y -= MC.GRAVITY / MC.LAVA_GRAVITY_DIV;
    }

    /** Vol en élytres (LivingEntity.travel, branche isElytraFlying). */
    travelElytra (world) {
      const vel = this.vel;
      if (vel.y > -0.5) this.fallDistance = 1;
      const look = this.getLookVec();
      const f = this.pitch;
      const d1 = Math.sqrt(look.x * look.x + look.z * look.z);
      const d3 = Math.hypot(vel.x, vel.z);
      const d4 = Math.hypot(look.x, look.y, look.z);
      let f1 = Math.cos(f);
      f1 = f1 * f1 * Math.min(1, d4 / 0.4);
      vel.y += MC.GRAVITY * (-1 + f1 * 0.75);
      if (vel.y < 0 && d1 > 0) {
        const d5 = vel.y * -0.1 * f1;
        vel.x += look.x * d5 / d1; vel.y += d5; vel.z += look.z * d5 / d1;
      }
      if (f < 0 && d1 > 0) {
        const d9 = d3 * -Math.sin(f) * 0.04;
        vel.x += -look.x * d9 / d1; vel.y += d9 * 3.2; vel.z += -look.z * d9 / d1;
      }
      if (d1 > 0) {
        vel.x += (look.x / d1 * d3 - vel.x) * 0.1;
        vel.z += (look.z / d1 * d3 - vel.z) * 0.1;
      }
      vel.x *= 0.99; vel.y *= 0.98; vel.z *= 0.99;
      this.move(world, vel.x, vel.y, vel.z);
      if (this.onGround) this.isGliding = false;
    }

    /* ----------------------------------------------------------------------
     * Collision : Entity.move / getAllowedMovement
     * -------------------------------------------------------------------- */

    /**
     * Déplace le joueur en résolvant les collisions.
     * Reproduit Entity.move() : balayage Y puis X puis Z (l'ordre de X et Z
     * dépend de |dx| < |dz|), avec la montée de marche de 0,6 bloc.
     */
    move (world, dx, dy, dz) {
      if (dx === 0 && dy === 0 && dz === 0) { this.collidedHorizontally = false; return; }
      const bb = this.getBoundingBox();
      const boxes = this.collectBoxes(world, bb, dx, dy, dz);

      /* maybeBackOffFromEdge : en s'accroupissant, on ne tombe pas des blocs */
      let mx = dx, my = dy, mz = dz;
      if (this.isSneaking && this.onGround && !this.isFlying) {
        const step = 0.05;
        while (mx !== 0 && !this.hasCollision(world, aabbOffset(bb, mx, -MC.STEP_HEIGHT, 0))) {
          if (mx < step && mx >= -step) mx = 0; else if (mx > 0) mx -= step; else mx += step;
        }
        while (mz !== 0 && !this.hasCollision(world, aabbOffset(bb, 0, -MC.STEP_HEIGHT, mz))) {
          if (mz < step && mz >= -step) mz = 0; else if (mz > 0) mz -= step; else mz += step;
        }
        while (mx !== 0 && mz !== 0 && !this.hasCollision(world, aabbOffset(bb, mx, -MC.STEP_HEIGHT, mz))) {
          if (mx < step && mx >= -step) mx = 0; else if (mx > 0) mx -= step; else mx += step;
          if (mz < step && mz >= -step) mz = 0; else if (mz > 0) mz -= step; else mz += step;
        }
      }

      const allowed = this.getAllowedMovement(world, boxes, { x: mx, y: my, z: mz }, bb);

      this.pos.x += allowed.x; this.pos.y += allowed.y; this.pos.z += allowed.z;

      /* Terrain (heightmap lisse) : sol continu, on ne s'y enfonce pas. */
      if (world && world.groundHeight) {
        const gy = world.groundHeight(this.pos.x, this.pos.z, this.getBoundingBox());
        if (this.pos.y < gy) {
          this.pos.y = gy;
          if (dy < 0) { this.vel.y = 0; allowed.y = gy - (bb.minY); this.collidedVertically = true; }
        }
      }

      /* Entity.move : MathHelper.epsilonEquals(1e-5) pour les collisions
       * horizontales (le jeu lisse les micro-déplacements résiduels). */
      this.collidedHorizontally = Math.abs(mx - allowed.x) >= 1e-5 || Math.abs(mz - allowed.z) >= 1e-5;
      this.collidedVertically = allowed.y !== my;
      this.onGround = this.collidedVertically && my < 0;

      /* Entity.move : la vitesse de l'axe bloqué est remise à zéro.
       * Sur l'axe Y, c'est Block.onLanded() : un bloc normal arrête net la
       * chute, un bloc de slime renvoie le joueur (vel.y = -vel.y). */
      if (allowed.x !== mx) this.vel.x = 0;
      if (allowed.z !== mz) this.vel.z = 0;
      if (allowed.y !== my) {
        const bouncy = world && world.isBouncy &&
          world.isBouncy(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.2), Math.floor(this.pos.z));
        this.vel.y = (bouncy && !this.isSneaking) ? -this.vel.y : 0;
      }

      /* Chute (Entity.updateFallState) */
      this.updateFallState(allowed.y, this.onGround);

      /* distanceWalkedModified : alimente le balancement de la caméra */
      this.distanceWalkedModified += Math.hypot(allowed.x, allowed.z) * 0.6;

      /* stats */
      this.stats.moveSpeed = Math.hypot(allowed.x, allowed.z) * MC.TPS;
    }

    /** Boîtes solides autour du déplacement. */
    collectBoxes (world, bb, dx, dy, dz) {
      if (!world || !world.getCollisionBoxes) return [];
      const query = aabbGrow(aabbExpand(bb, dx, dy, dz), 0.001, MC.STEP_HEIGHT + 0.001, 0.001);
      return world.getCollisionBoxes(query) || [];
    }
    hasCollision (world, bb) {
      if (world && world.groundHeight) {
        const gy = world.groundHeight((bb.minX + bb.maxX) / 2, (bb.minZ + bb.maxZ) / 2, bb);
        if (bb.minY < gy) return true;
      }
      if (!world || !world.getCollisionBoxes) return false;
      const boxes = world.getCollisionBoxes(bb) || [];
      for (const b of boxes) {
        if (b.maxX > bb.minX && b.minX < bb.maxX &&
            b.maxY > bb.minY && b.minY < bb.maxY &&
            b.maxZ > bb.minZ && b.minZ < bb.maxZ) return true;
      }
      return false;
    }

    /** Entity.getAllowedMovement (avec la montée de marche). */
    getAllowedMovement (world, boxes, vec, bb) {
      if (vec.x * vec.x + vec.y * vec.y + vec.z * vec.z === 0) return { x: 0, y: 0, z: 0 };
      let res = this.collideBoundingBox(boxes, bb, vec);
      const flagX = vec.x !== res.x;
      const flagY = vec.y !== res.y;
      const flagZ = vec.z !== res.z;
      const canStep = this.onGround || (flagY && vec.y < 0);

      if (MC.STEP_HEIGHT > 0 && canStep && (flagX || flagZ)) {
        const stepBoxes = this.collectBoxes(world, bb, vec.x, MC.STEP_HEIGHT, vec.z);
        const v1 = this.collideBoundingBox(stepBoxes, bb, { x: vec.x, y: MC.STEP_HEIGHT, z: vec.z });
        const v2 = this.collideBoundingBox(stepBoxes,
          aabbExpand(bb, vec.x, 0, vec.z), { x: 0, y: MC.STEP_HEIGHT, z: 0 });
        if (v2.y < MC.STEP_HEIGHT) {
          const v3 = this.collideBoundingBox(stepBoxes, aabbOffset(bb, 0, v2.y, 0),
            { x: vec.x, y: 0, z: vec.z });
          if (v3.x * v3.x + v3.z * v3.z > v1.x * v1.x + v1.z * v1.z) {
            v1.x = v3.x; v1.y = v3.y + v2.y; v1.z = v3.z;
          }
        }
        if (v1.x * v1.x + v1.z * v1.z > res.x * res.x + res.z * res.z) {
          const down = this.collideBoundingBox(stepBoxes, aabbOffset(bb, v1.x, v1.y, v1.z),
            { x: 0, y: -v1.y + vec.y, z: 0 });
          return { x: v1.x + down.x, y: v1.y + down.y, z: v1.z + down.z };
        }
      }
      return res;
    }

    /** Entity.collideBoundingBox : Y d'abord, puis Z ou X selon |dx| < |dz|. */
    collideBoundingBox (boxes, bb, vec) {
      let dx = vec.x, dy = vec.y, dz = vec.z;
      let box = bb;
      if (dy !== 0) {
        dy = maxOffset(1, boxes, box, dy);
        if (dy !== 0) box = aabbOffset(box, 0, dy, 0);
      }
      const zFirst = Math.abs(dx) < Math.abs(dz);
      if (zFirst && dz !== 0) {
        dz = maxOffset(2, boxes, box, dz);
        if (dz !== 0) box = aabbOffset(box, 0, 0, dz);
      }
      if (dx !== 0) {
        dx = maxOffset(0, boxes, box, dx);
        if (dx !== 0) box = aabbOffset(box, dx, 0, 0);
      }
      if (!zFirst && dz !== 0) {
        dz = maxOffset(2, boxes, box, dz);
      }
      return { x: dx, y: dy, z: dz };
    }

    /** Entity.updateFallState : distance de chute (dégâts de chute). */
    updateFallState (dy, onGround) {
      if (onGround) {
        if (this.fallDistance > 0) {
          this.landedDistance = this.fallDistance;
          this.fallDistance = 0;
        }
      } else if (dy < 0) {
        this.fallDistance -= dy;
      }
    }

    /* ----------------------------------------------------------------------
     * Animation
     * -------------------------------------------------------------------- */

    /**
     * LivingEntity.func_233629_a_ :
     *   f = min(distance parcourue sur le tick * 4, 1)
     *   limbSwingAmount += (f - limbSwingAmount) * 0,4
     *   limbSwing += limbSwingAmount
     */
    updateLimbs () {
      const d0 = this.pos.x - this.prevPos.x;
      const d1 = this.pos.y - this.prevPos.y;
      const d2 = this.pos.z - this.prevPos.z;
      let f = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2) * MC.LIMB_SWING_SCALE;
      if (f > 1) f = 1;
      this.limbSwingAmount += (f - this.limbSwingAmount) * MC.LIMB_SWING_SMOOTHING;
      this.limbSwing += this.limbSwingAmount;
    }

    /** LivingEntity.updateArmSwingProgress : 6 ticks d'animation d'attaque. */
    updateArmSwing () {
      const end = MC.SWING_DURATION_TICKS;
      if (this.isSwingInProgress) {
        this.swingProgressInt++;
        if (this.swingProgressInt >= end) { this.swingProgressInt = 0; this.isSwingInProgress = false; }
      } else {
        this.swingProgressInt = 0;
      }
      this.swingProgress = this.swingProgressInt / end;
    }
    /** Déclenche l'animation d'attaque (LivingEntity.swingArm). */
    swingArm () { this.isSwingInProgress = true; this.swingProgressInt = 0; }

    /* ----------------------------------------------------------------------
     * Caméra
     * -------------------------------------------------------------------- */

    /**
     * AbstractClientPlayerEntity.getFovModifier() :
     *   × 1,1 en vol, puis (vitesseAttribut / vitesseDeMarche + 1) / 2
     * Le sprint passe l'attribut à 0,13 -> (1,3 + 1) / 2 = 1,15 (+15 % de FOV).
     */
    getFovModifierRaw () {
      let f = 1;
      if (this.isFlying) f *= MC.FOV_FLYING_MULTIPLIER;
      const ws = this.abilities.walkSpeed;
      f = f * ((this.getMoveSpeedAttribute() / ws + 1) / 2);
      if (ws === 0 || !isFinite(f)) f = 1;
      return f;
    }

    /** ActiveRenderInfo.interpolateHeight() : lissage de la hauteur d'œil. */
    interpolateEyeHeight () {
      this.eyeHeight += (this.getEyeHeightFor(this.getPose()) - this.eyeHeight) * MC.EYE_SMOOTHING;
      return this.eyeHeight;
    }

    /**
     * GameRenderer.applyBobbing() : balancement de la caméra synchronisé
     * sur les pas. `alpha` = fraction du tick courant (0 → 1).
     * Retourne {x, y, roll, pitch} en unités monde / radians.
     */
    bobView (alpha) {
      const f = this.distanceWalkedModified - this.prevDistanceWalkedModified;
      const f1 = -(this.distanceWalkedModified + f * alpha);
      const f2 = lerp(this.prevCameraYaw, this.cameraYaw, alpha);
      const s = Math.sin(f1 * Math.PI), c = Math.cos(f1 * Math.PI);
      return {
        x: s * f2 * MC.BOB_X_AMPLITUDE,
        y: -Math.abs(c * f2) * MC.BOB_Y_AMPLITUDE,
        roll: s * f2 * MC.BOB_ROLL_AMPLITUDE * DEG,
        pitch: Math.abs(Math.cos(f1 * Math.PI - MC.BOB_PITCH_OFFSET) * f2) * MC.BOB_PITCH_AMPLITUDE * DEG,
      };
    }

    /**
     * GameRenderer.hurtCameraEffect() : inclinaison quand on prend des dégâts.
     * Retourne {roll, yaw} en radians.
     */
    hurtTilt (alpha) {
      /* GameRenderer.hurtCameraEffect :
       *   f = hurtTime - alpha ; f /= maxHurtTime ; f = sin(f⁴ × PI)
       *   rotateY(-f2) ; rotateZ(-f × 14°) ; rotateY(+f2)
       * Le jeu rend la composition exacte ; on renvoie donc les
       * composants bruts (f = facteur 0→1, f2 = yaw de l'attaque). */
      let f = this.hurtTime - alpha;
      let deathRoll = 0;
      if (this.dead) {
        /* renderWorld : rotateZ(40 - 8000 / (deathTime + 200)) */
        const f1 = Math.min(this.deathTime + alpha, 20);
        deathRoll = (40 - 8000 / (f1 + 200)) * DEG;
      }
      if (f <= 0) return { f: 0, f2: 0, deathRoll, roll: 0, yaw: 0 };
      f = f / this.maxHurtTime;
      f = Math.sin(f * f * f * f * Math.PI);
      const f2 = this.attackedAtYaw * DEG;
      const roll = -f * MC.HURT_ROLL_DEGREES * DEG * Math.cos(f2);
      const yaw = -f * MC.HURT_ROLL_DEGREES * DEG * Math.sin(f2);
      return { f, f2, deathRoll, roll, yaw };
    }

    /** À appeler quand le joueur subit des dégâts (LivingEntity.attackEntityFrom). */
    onHurt (sourceYawDegrees) {
      this.maxHurtTime = MC.HURT_MAX_TIME;
      this.hurtTime = MC.HURT_MAX_TIME;
      this.attackedAtYaw = sourceYawDegrees || 0;
    }

    /* ----------------------------------------------------------------------
     * Utilitaires de rendu
     * -------------------------------------------------------------------- */

    /** Position interpolée pour le rendu (Entity.getPosition(partialTicks)). */
    renderPos (alpha) {
      return {
        x: lerp(this.prevPos.x, this.pos.x, alpha),
        y: lerp(this.prevPos.y, this.pos.y, alpha),
        z: lerp(this.prevPos.z, this.pos.z, alpha),
      };
    }
    renderYaw (alpha) { return lerp(this.prevYaw, this.yaw, alpha); }
    renderPitch (alpha) { return lerp(this.prevPitch, this.pitch, alpha); }
    /** Valeurs d'animation interpolées (pour le modèle 3D). */
    renderLimb (alpha) {
      return {
        swing: this.limbSwing,
        amount: lerp(this.prevLimbSwingAmount, this.limbSwingAmount, alpha),
        swingProgress: this.swingProgress,
      };
    }
    /** Champ de vision courant (GameRenderer.getFOVModifier). */
    getFov (alpha, baseFov) {
      const m = lerp(this.fovMultiplierPrev, this.fovMultiplier, alpha);
      return (baseFov === undefined ? MC.DEFAULT_FOV : baseFov) * m;
    }
  }

  /* ==========================================================================
   * 4. ANIMATION DU MODÈLE (BipedModel.setRotationAngles)
   * ==========================================================================*/

  const MCAnim = {
    /**
     * Angles des membres, en radians, tels que calculés par
     * BipedModel.setRotationAngles(limbSwing, limbSwingAmount).
     * Convention : une rotation X positive penche / lève la partie vers
     * l'arrière (pied en arrière), comme dans le jeu.
     */
    limbAngles (limbSwing, limbSwingAmount) {
      const f = 1;
      const L = limbSwing * MC.LIMB_SWING_FREQUENCY;
      const a = limbSwingAmount;
      return {
        legR: Math.cos(L) * MC.LIMB_LEG_AMPLITUDE * a / f,
        legL: Math.cos(L + Math.PI) * MC.LIMB_LEG_AMPLITUDE * a / f,
        armR: Math.cos(L + Math.PI) * MC.LIMB_ARM_AMPLITUDE * a * MC.LIMB_ARM_SCALE / f,
        armL: Math.cos(L) * MC.LIMB_ARM_AMPLITUDE * a * MC.LIMB_ARM_SCALE / f,
      };
    },
    /** Jambes en nage (BipedModel : 0,3 × cos(limbSwing × 0,33333334)). */
    swimLegAngles (limbSwing, limbSwingAmount) {
      const L = limbSwing * MC.SWIM_LEG_FREQUENCY;
      return {
        legR: MC.SWIM_LEG_AMPLITUDE * Math.cos(L),
        legL: MC.SWIM_LEG_AMPLITUDE * Math.cos(L + Math.PI),
      };
    },
    /** Pose accroupie (BipedModel : isSneak). */
    sneakPose: {
      bodyX: 0.5, armAdd: 0.4, legZ: 4.0, legY: 12.2, headY: 4.2, bodyY: 3.2, armY: 5.2,
    },
    standingPose: {
      bodyX: 0.0, armAdd: 0.0, legZ: 0.1, legY: 12.0, headY: 0.0, bodyY: 0.0, armY: 2.0,
    },
    /**
     * Animation d'attaque (LivingEntityModel.handSwingProgress).
     * `getArmAngleSq` : 1 - (1-t)^(2n+2) lissé, utilisé pour la courbe du bras.
     */
    armSwing (swingProgress) {
      if (swingProgress <= 0) return { swing: 0, bodyYaw: 0, armPitch: 0, armRoll: 0 };
      const m = swingProgress;
      const bodyYaw = Math.sin(Math.sqrt(m) * Math.PI * 2) * 0.2;
      const armPitch = Math.sin(m * Math.PI) * -1.0;      // le bras part vers le haut
      const armRoll = Math.sin(m * Math.PI) * -0.4;
      return { swing: m, bodyYaw, armPitch, armRoll };
    },
  };

  return { MC, MCPlayer, MCAnim, aabb, clamp, lerp };
});
