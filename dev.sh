#!/bin/sh
npm --prefix=client run dev -- -p 2346 & npm --prefix=app run dev && kill $!