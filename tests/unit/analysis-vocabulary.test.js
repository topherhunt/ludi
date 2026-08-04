/**
 * The model emits bare float vectors -- 50 activations, 2 class probabilities per
 * head -- with no names attached. Everything downstream depends on our stored
 * vocabulary lining up with the model files exactly. A single reordered entry
 * would mislabel the entire library with no error anywhere.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  MSD_CLASSES, MSD_TAG_NAMES, AXES, MIREX_CLUSTERS, HEAD_NAMES, EMBEDDING_DIMS, ACTIVATION_DIMS,
} from '../../src/main/analysis/vocabulary.js';

const MODELS_DIR = path.resolve(__dirname, '../../src/renderer/public/models');

const readModelMeta = (file) => JSON.parse(fs.readFileSync(path.join(MODELS_DIR, file), 'utf8'));

describe('MSD class vocabulary', () => {
  it('matches the main model\'s class list exactly, in order', () => {
    expect(MSD_CLASSES).toEqual(readModelMeta('msd-musicnn-1.json').classes);
  });

  it('declares a tag name or an explicit null for every class', () => {
    for (const className of MSD_CLASSES) {
      expect(MSD_TAG_NAMES, `no entry for "${className}"`).toHaveProperty(className);
    }
    expect(Object.keys(MSD_TAG_NAMES).sort()).toEqual([...MSD_CLASSES].sort());
  });

  it('has one activation per class', () => {
    expect(ACTIVATION_DIMS).toBe(MSD_CLASSES.length);
  });
});

describe('classification heads', () => {
  it('has a vendored model file for every head an axis names', () => {
    for (const head of HEAD_NAMES) {
      expect(fs.existsSync(path.join(MODELS_DIR, 'heads', `${head}-msd-musicnn-1.onnx`)), head).toBe(true);
    }
  });

  it('names a positive class that its head actually has', () => {
    for (const axis of AXES) {
      const classes = readModelMeta(`heads/${axis.head}-msd-musicnn-1.json`).classes;
      expect(classes, `${axis.key} -> ${axis.head}`).toContain(axis.positive);
    }
  });

  it('reads the positive class by name because the heads disagree on order', () => {
    // Not a hypothetical: these two heads put the positive class in opposite
    // slots. If this ever stops being true the by-name lookup is still correct,
    // but the comment explaining why it exists would be stale.
    const danceability = readModelMeta('heads/danceability-msd-musicnn-1.json').classes;
    const party = readModelMeta('heads/mood_party-msd-musicnn-1.json').classes;
    expect(danceability.indexOf('danceable')).toBe(0);
    expect(party.indexOf('party')).toBe(1);
  });

  it('uses distinct axis keys and tag names', () => {
    const keys = AXES.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    const tags = AXES.flatMap((a) => [a.tag, a.lowTag]).filter(Boolean);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('never reuses an MSD tag name for an axis tag', () => {
    // Two sources feeding one tag name would mean two different calibrations
    // writing the same pill, which reads as the tagger contradicting itself.
    const msdNames = new Set(Object.values(MSD_TAG_NAMES).filter(Boolean));
    for (const axis of AXES) {
      if (axis.tag) expect(msdNames.has(axis.tag), `${axis.tag} collides`).toBe(false);
      if (axis.lowTag) expect(msdNames.has(axis.lowTag), `${axis.lowTag} collides`).toBe(false);
    }
  });
});

describe('MIREX mood clusters', () => {
  it('has one entry per class of the moods_mirex head, in order', () => {
    const classes = readModelMeta('heads/moods_mirex-msd-musicnn-1.json').classes;
    expect(MIREX_CLUSTERS).toHaveLength(classes.length);
    // The head's class names are the full MIREX descriptions ("passionate,
    // rousing, confident, boisterous, rowdy"); `tag` is our short handle for it.
    MIREX_CLUSTERS.forEach((cluster, i) => expect(cluster.description).toBe(classes[i]));
  });
});

describe('output shapes', () => {
  const meta = readModelMeta('msd-musicnn-1.json');
  const outputBy = (purpose) => meta.schema.outputs.find((o) => o.output_purpose === purpose);

  it('expects the embedding width the model declares', () => {
    expect(EMBEDDING_DIMS).toBe(outputBy('embeddings').shape.at(-1));
  });

  it('expects the activation width the model declares', () => {
    expect(ACTIVATION_DIMS).toBe(outputBy('predictions').shape.at(-1));
  });
});
