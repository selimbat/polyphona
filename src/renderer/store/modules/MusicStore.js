import Tone from 'tone'
import {remote} from 'electron'
import {Track, SCALE} from '../Music'
import fs from 'fs'
import * as MidiConvert from 'simonadcock-midiconvert'

// NOTE: synthesizer cannot be in the store because Tone modifies this value
// (and does so outside of a mutation, which Vuex does not like).
const synthesizer = new Tone.Synth().toMaster()
Tone.Transport.bpm.value = 120

class RenderContext {
  constructor (musicContext) {
    this.musicContext = musicContext
  }

  get percentPerTick () {
    return 100 / (4 * this.musicContext.division)
  }

  get percentPerInterval () {
    return 100 / Object.keys(this.musicContext.scale).length
  }
}

class MusicContext {
  constructor () {
    this.division = 4
    this.scale = SCALE
    this.octave = 2
    this.playing = false
  }

  toTransportTime (canvasTime) {
    // Notation: "bar:quarter:sixteenth"
    // See: https://github.com/Tonejs/Tone.js/wiki/Time#transport-time
    const quarter = Math.floor(canvasTime / this.division)
    const sixteenth = 4 / this.division * (canvasTime % this.division)
    return `0:${quarter}:${sixteenth}`
  }
}

class State {
  constructor () {
    this.currentTrack = new Track()
    this.musicContext = new MusicContext()
    this.renderContext = new RenderContext(this.musicContext)
  }
}

const state = new State()

const getters = {
  listNotes: (state) => state.currentTrack.notes,
  getTrack: (state) => state.currentTrack,
  getRenderContext: (state) => state.renderContext,
  getMusicContext: (state) => state.musicContext,
  getOctave: (state) => state.musicContext.octave,
  getPlaying: (state) => state.musicContext.playing
}

const mutations = {
  ADD_NOTE (state, note) {
    state.currentTrack.addNote(note)
  },
  DELETE_NOTE (state, note) {
    state.currentTrack.deleteNote(note)
  },
  SCHEDULE_NOTES (state) {
    state.currentTrack.notes.forEach((note) => {
      const pitch = (
        state.musicContext.scale[note.pitch] + state.musicContext.octave
      )
      Tone.Transport.schedule(
        (time) => {
          synthesizer.triggerAttackRelease(
            pitch,
            state.musicContext.toTransportTime(note.duration),
            time,
            note.velocity
          )
        },
        state.musicContext.toTransportTime(note.startTime)
      )
    })
  },
  START (state) {
    state.musicContext.playing = true
  },
  STOP (state) {
    state.musicContext.playing = false
  },
  SET_OCTAVE (state, octave) {
    state.musicContext.octave = octave
  }
}

const actions = {
  addNote (context, note) {
    context.commit('ADD_NOTE', note)
    context.dispatch('restart')
  },
  deleteNote (context, note) {
    context.commit('DELETE_NOTE', note)
    context.dispatch('restart')
  },
  play ({commit}, offset) {
    commit('START')
    commit('SCHEDULE_NOTES')
    // Loop one measure ad eternam
    Tone.Transport.loopEnd = '1m'
    Tone.Transport.loop = true
    // Start the song now, but offset by `offset`.
    Tone.Transport.start(Tone.Transport.now(), offset)
  },
  stop ({commit}) {
    commit('STOP')
    Tone.Transport.stop()
    // Cancel all note events so they are not played again
    // when the transport starts again.
    Tone.Transport.cancel()
  },
  restart (context) {
    if (context.state.musicContext.playing) {
      const offset = Tone.Transport.getSecondsAtTime()
      context.dispatch('stop')
      context.dispatch('play', offset)
    }
  },
  togglePlay (context) {
    if (context.state.musicContext.playing) {
      context.dispatch('stop')
    } else {
      context.dispatch('play')
    }
  },
  updateOctave (context, octave) {
    context.commit('SET_OCTAVE', octave)
    context.dispatch('restart')
  },
  exportMidi ({state}) {
    const midi = MidiConvert.create()

    // TODO: make channel/instrument customizable
    const channel = 32
    const track = midi.track().patch(channel)

    const toMidiTime = (canvasTime) => (
      canvasTime /
      state.musicContext.division /
      (Tone.Transport.bpm.value / 60)
    )

    state.currentTrack.notes.forEach((note) => {
      const pitch = (
        state.musicContext.scale[note.pitch].toLowerCase() + state.musicContext.octave.toString()
      )
      track.note(
        pitch,
        toMidiTime(note.startTime),
        toMidiTime(note.duration),
        note.velocity
      )
    })

    const path = remote.dialog.showSaveDialog({
      'filters': [
        {
          'name': 'MIDI',
          'extensions': ['midi']
        }
      ]
    })
    if (!path) {
      return
    }
    // write the output in the path chosen by the user
    fs.writeFileSync(path, midi.encode(), 'binary')
  }
}

export default {
  namespaced: true,
  state: state,
  mutations: mutations,
  getters: getters,
  actions: actions
}
