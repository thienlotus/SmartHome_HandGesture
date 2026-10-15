import traceback
import runpy
try:
    runpy.run_path('main.py')
except Exception as e:
    traceback.print_exc()
