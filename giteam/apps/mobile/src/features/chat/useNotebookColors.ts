import { useMemo } from 'react';

export type NotebookColors = {
  shell: string;
  main: string;
  left: string;
  right: string;
  paper: string;
  text: string;
  muted: string;
  faint: string;
  line: string;
  chip: string;
  chipText: string;
  active: string;
  ink: string;
  topControl: string;
  topControlBorder: string;
};

export function useNotebookColors(notebookTheme: 'paper' | 'slate'): NotebookColors {
  return useMemo(() => {
    if (notebookTheme === 'slate') {
      return {
        shell: '#eef1f5',
        main: '#f7f8fa',
        left: '#eef1f5',
        right: '#eef1f5',
        paper: '#ffffff',
        text: '#2f3338',
        muted: '#6b737c',
        faint: '#8b939b',
        line: 'rgba(47,51,56,0.12)',
        chip: '#dfe6ee',
        chipText: '#4d5660',
        active: '#e7eaee',
        ink: '#1f2937',
        topControl: 'rgba(223,230,238,0.58)',
        topControlBorder: 'rgba(47,51,56,0.07)'
      };
    }
    return {
      shell: '#f7f3ea',
      main: '#f8f5ee',
      left: '#f7f3ea',
      right: '#f7f3ea',
      paper: '#fffdf7',
      text: '#24211d',
      muted: '#7c766c',
      faint: '#9a9182',
      line: 'rgba(65,54,38,0.10)',
      chip: '#ece8df',
      chipText: '#5d5345',
      active: '#f0e9dc',
      ink: '#24211d',
      topControl: 'rgba(236,232,223,0.62)',
      topControlBorder: 'rgba(65,54,38,0.10)'
    };
  }, [notebookTheme]);
}
