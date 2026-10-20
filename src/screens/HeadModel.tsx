import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { SHARD_SLOT_KEYS, type ShardSlotKey } from '../lib/shards'
import styles from './Shard.module.css'

/** Where each slot anchor lands, in percent of the canvas box. */
export type SlotAnchors = Record<ShardSlotKey, { x: number; y: number }>

/** Turned so the ports on the head's right side face the camera; the idle sway
 *  stays inside ±SWAY so they never swing behind the skull. */
const BASE_YAW = -0.55
const SWAY = 0.16

const BRAIN_GLOW = 0.4
const SHELLS = new Set(['holo_skin', 'holo_bone'])

/** Fresnel hologram shell: alpha rises toward the silhouette. Additive and
 *  depth-write off, so nested shells never sort-flicker. */
function rimMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uPower: { value: 2.2 }, uFloor: { value: 0.04 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower; uniform float uFloor;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
        gl_FragColor = vec4(uColor, uFloor + rim);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  })
}

/** The holographic head (public/guide_head.glb). The model's `slot1..3` empties
 *  are the ONLY source of the port positions: every rendered frame projects them
 *  and hands them to `onFrame`, which moves the HTML ports and redraws the
 *  connectors. Renders continuously only while visible and motion is allowed. */
export function HeadModel({ onFrame }: { onFrame: (anchors: SlotAnchors) => void }) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    // A fresh canvas per mount: cleanup force-loses the context, and a canvas
    // only ever hands out its first context (StrictMode remounts would get the
    // dead one back).
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    box.appendChild(renderer.domElement)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.2)
    key.position.set(-1, 1, 2)
    scene.add(key)
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 10)
    const pivot = new THREE.Group()
    scene.add(pivot)

    const anchors: THREE.Object3D[] = []
    const v = new THREE.Vector3()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let disposed = false, raf = 0, loaded = false
    const t0 = performance.now()

    function render() {
      if (!loaded) return
      const t = (performance.now() - t0) / 1000
      pivot.rotation.y = BASE_YAW + (still ? 0 : Math.sin(t * 0.35) * SWAY)
      renderer.render(scene, camera)
      const out = {} as SlotAnchors
      SHARD_SLOT_KEYS.forEach((k, i) => {
        anchors[i].getWorldPosition(v).project(camera)
        out[k] = { x: (v.x + 1) * 50, y: (1 - v.y) * 50 }
      })
      onFrameRef.current(out)
    }
    function loop() {
      render()
      raf = requestAnimationFrame(loop)
    }
    function start() {
      cancelAnimationFrame(raf)
      render() // one synchronous frame, so a paused rAF still shows the head
      if (!still && !document.hidden) raf = requestAnimationFrame(loop)
    }

    function resize() {
      const { clientWidth: w, clientHeight: h } = box!
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      render()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(box)
    const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start())
    document.addEventListener('visibilitychange', onVis)

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    loader.load('/guide_head.glb', gltf => {
      if (disposed) return
      const head = gltf.scene
      head.traverse(o => {
        const mesh = o as THREE.Mesh
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined
        if (!mat?.transparent) return
        // Shells (skin, skull) become rim-lit: clear where they face you, bright
        // at the silhouette, so the brain and vessels show through. Inner parts
        // keep their material but add light instead of covering what's behind.
        if (SHELLS.has(mat.name)) { mesh.material = rimMaterial(mat.emissive); mat.dispose(); return }
        mat.blending = THREE.AdditiveBlending
        mat.depthWrite = false
        // Additive stacking washes the brain out to white at its authored glow.
        if (mat.name === 'holo_brain') mat.emissiveIntensity *= BRAIN_GLOW
      })
      // Centre on the pivot and fit the camera to the head's height.
      const box = new THREE.Box3().setFromObject(head)
      const size = box.getSize(new THREE.Vector3())
      head.position.sub(box.getCenter(new THREE.Vector3()))
      pivot.add(head)
      const dist = (size.y * 0.56) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      camera.position.set(0, 0, dist)
      camera.lookAt(0, 0, 0)
      for (const k of SHARD_SLOT_KEYS) {
        const a = head.getObjectByName(k)
        if (!a) { console.error(`[HeadModel] guide_head.glb has no "${k}" anchor`); return }
        anchors.push(a)
      }
      loaded = true
      resize()
      start()
    }, undefined, err => console.error('[HeadModel] failed to load guide_head.glb', err))

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      scene.traverse(o => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
        mats.forEach(x => x.dispose())
      })
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={boxRef} className={styles.headCanvas} aria-label="Holographic cranial scan showing brain and vasculature" role="img" />
}
