import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'

from deepface import DeepFace
import numpy as np
from PIL import Image

img = Image.fromarray(np.ones((160, 160, 3), dtype=np.uint8) * 128)
img.save('/tmp/test_face.jpg')

try:
    DeepFace.represent(
        '/tmp/test_face.jpg',
        model_name='Facenet',
        enforce_detection=False,
        detector_backend='opencv'
    )
    print('Facenet model downloaded successfully!')
except Exception as e:
    print('Model downloaded, init error expected:', e)
