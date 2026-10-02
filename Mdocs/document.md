---
title: A title
subtitle: A subtitle
authors:
  - author names, one per line
date: 2026-09-19
license: GPL-3.0-or-later
github: https://github.com/jfbercher/Mystral-Editor
bibliography: fourier_signal.bib
citation-style: author-year
citation-template: "[{year}]-{authors} ({year}). *{title}*. {container}{volume}{pages}.{doilink}"
settings:
    myst_to_tex:
        code_style: listings
    output_stderr: remove
    output_matplotlib_strings: remove
exports:
  - format: docx
  - format: pdf
    template: arxiv_nips
    article_type: article
    chapters: []
numbering:
  headings: true # activate headings numbering
  equations: true 
  figure: true
    #template: Fig. %s # Define the prefix
math:
  '\sha': 'ш'
  '\dr': '\mathrm{d}#1'
  '\wb': '\mathbf{w}' 
---


:::{toc} Contents
::: 

## First section

We have the Fourier transform, see eg {cite}`mallat2009wavelet`, or [@oppenheim1999dtsp; @oppenheim2010signals] as:
$$
\label{Fourier}
X(f) = \sum_{n=1}^N x(n) e^{-j2\pi f n}
$$, 


## Second section

Together with the [Fourier transfom](#Fourier), equation {eq}`Fourier`, we have it inverse given as
:::{math}
:label: InverseFourier

x(n) = \int_{[1]} X(f) e^{+j2\pi f n} \dr{x}
:::

that can also be referred [](#InverseFourier). Nice no? 










