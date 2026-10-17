---
title: A title
subtitle: A subtitle2
authors:
  - author names, one per line
date: 2026-09-19
license: GPL-3.0-or-later
github: https://github.com/jfbercher/Mystral-Editor
bibliography: fourier_signal.bib
citation-style: author-year # or numeric
citation-template: "{authors} ({year}). *{title}*. {container}{volume}{pages}.{doilink}"
settings:
    myst_to_tex:
        code_style: listings
    output_stderr: remove
    output_matplotlib_strings: remove
exports:
  - format: docx
  - format: tex
    template: elsarticle_myst
    article_type: article
  - format: pdf
    template: elsarticle_myst #arxiv_nips
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

::::{note} Fourier
:class: dropdown
:label: noteFourier

:::{image} https://thumb.wikimedia.org/wikipedia/commons/thumb/a/aa/Fourier2.jpg/500px-Fourier2.jpg
:width: 40%
:align: left
:::

(from [Wikipedia](https://en.wikipedia.org/wiki/Joseph_Fourier)) - Jean-Baptiste Joseph **Fourier**,  (21 March 1768 – 16 May 1830) was a French mathematician and physicist. Fourier accompanied Napoleon Bonaparte on his Egyptian expedition in 1798. In 1801, Napoleon appointed Fourier Prefect (Governor) of the Department of Isère in Grenoble. In 1822, Fourier succeeded Jean Baptiste Joseph Delambre as Permanent Secretary of the French Academy of Sciences. In 1822, Fourier published his treatise on heat flow in "*Théorie analytique de la chaleur*".
::::


:::{toc} Contents
:::

## {sc}`Fourier` Series

In 1822, Joseph {sc}`Fourier`, see [Note Fourier](#noteFourier), introduced a decomposition of perodic functions into a sum of harmonics with frequencies multiple of the fundamental frequency of the periodic function. Such decomposition (and its extension) now hold his name and are known as Fourier Series 
% Check the year ! 1822 ?


:::{proof:proposition} Fourier series pair
:icon: false
:label: fsp

\
Let $x_T(t)$ be a periodic function with period $T$. Then, under some regularity conditions, we have
$$
\label{FT}
x_T(t) = \sum_{k=-\infty}^{+\infty} c_k \exp(j2\pi \frac{k}{T} t)
$$
with 
 $$c_k = \frac{1}{T} \int_{[T]} x_T(t) \exp(-j2\pi \frac{k}{T} t) \dr{t}
 $$
:::


References are plentiful, let us cite  e.g. [@oppenheim1999dtsp; @oppenheim2010signals]

:::{exercise} Rectangular Pulse Train
:label: rectPulse
:enumerated: true

Using formulas

:::

## Second section



:::{code-cell} 
:figwidth: 40%
import numpy as np
N = 1000
fo = 50
T = 1/fo
t = np.linspace(-T, T, N)
s = np.zeros_like(t)

P = 8
for p in range(0,P):
  cp = 1/(2*p+1)*np.sin((2*p+1)*2*np.pi*fo*t)
  s = s + cp

plt.plot(t, s)
plt.xlabel("Time (s)")
plt.grid()
:::


And the Fourier transform: 

:::{code-cell}
:figwidth: 40%
Fs = N/(2*T)
f = np.linspace(0, Fs, N)
Sf = np.fft.fft(s)
M = 10
plt.stem(f[0:M], abs(Sf)[0:M])
_ = plt.xlabel("Frequency (Hz)")
:::








