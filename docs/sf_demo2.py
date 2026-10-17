:::{code-cell}
:figwidth: 40%
Fs = N/(2*T)
f = np.linspace(0, Fs, N)
Sf = np.fft.fft(s)
M = 10
plt.stem(f[0:M], abs(Sf)[0:M])
_ = plt.xlabel("Frequency (Hz)")
:::