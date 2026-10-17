:::{code-cell} 
:figwidth: 40%
import numpy as np
N = 1000
fo = 40
T = 1/fo
t = np.linspace(-T, T, N)
s = np.zeros_like(t)

P = 1
for p in range(0,P):
  cp = 1/(2*p+1)*np.sin((2*p+1)*2*np.pi*fo*t)
  s = s + cp

plt.plot(t, s)
plt.xlabel("Time (s)")
plt.grid()
:::